import { createHash } from 'node:crypto'
import type { SessionAuditReconstruction } from '@nodeaccess/shared'
import { AppError } from '../../shared/errors.js'
import type { SessionAuditRepository, SessionAuditRow } from './session-audit.repository.js'
import type { SessionAuditStorage } from './session-audit.storage.js'
import type { AuditReconstructionStore } from './session-audit-reconstruction.repository.js'
import { reconstructAudit, type AuditSnapshot, type AuditChunkInput } from './session-audit-reconstruction.js'

type CacheEntry={snapshot:AuditSnapshot;expires:number;key:string;size:number}
/** Per-process bounded cache and single flight. Every access first revalidates tenant ownership. */
export class SessionAuditReconstructionService {
  private readonly cache=new Map<string,CacheEntry>()
  private readonly pending=new Map<string,{key:string;promise:Promise<AuditSnapshot>}>()
  private bytes=0
  private active=0
  private readonly queue:Array<()=>void>=[]
  constructor(private readonly repo:Pick<SessionAuditRepository,'findBySessionId'|'listChunks'>,private readonly storage:Pick<SessionAuditStorage,'readChunk'>,private readonly store?:AuditReconstructionStore,
    private readonly options={cacheBytes:32*1024*1024,maxSourceBytes:128*1024*1024,completedTtlMs:60000,runningTtlMs:2000,now:(): number=>Date.now()}) {}
  private async authorize(tenantId:number,sessionId:number): Promise<SessionAuditRow> {
    if(!Number.isSafeInteger(sessionId)||sessionId<=0)throw new AppError('Sessão inválida',400,'INVALID_AUDIT_SESSION')
    const row=await this.repo.findBySessionId(tenantId,sessionId)
    if(!row||row.tenantId!==tenantId)throw new AppError('Sessão auditada não encontrada',404,'SESSION_AUDIT_NOT_FOUND')
    if(row.status==='PURGED') {this.evict(`${tenantId}:${sessionId}`);throw new AppError('A gravação foi removida pela política de retenção.',410,'SESSION_AUDIT_PURGED')}
    return row
  }
  private evict(key:string):void {const old=this.cache.get(key);if(old)this.bytes-=old.size;this.cache.delete(key)}
  async snapshot(tenantId:number,sessionId:number,force=false):Promise<AuditSnapshot> {
    const row=await this.authorize(tenantId,sessionId)
    const scope=`${tenantId}:${sessionId}`
    const key=JSON.stringify([row.status,row.chunkCount,String(row.bytesIn),String(row.bytesOut)])
    const cached=this.cache.get(scope)
    if(!force&&cached&&cached.key===key&&cached.expires>this.options.now()) {this.cache.delete(scope);this.cache.set(scope,cached);return cached.snapshot}
    this.evict(scope)
    const previous=this.pending.get(scope)
    if(previous) {
      const result = await previous.promise
      await this.authorize(tenantId,sessionId)
      if (previous.key === key) return result
      return this.snapshot(tenantId,sessionId,force)
    }
    if(this.active>=2 && this.queue.length>=8)throw new AppError('O processador de auditorias está ocupado. Tente novamente em instantes.',503,'AUDIT_PROCESSOR_BUSY')
    const work=(async(): Promise<AuditSnapshot>=>{
      if(this.active>=2)await new Promise<void>(resolve=>this.queue.push(resolve));else this.active++
      try {
        const chunks=await this.repo.listChunks(sessionId)
        const sources:AuditChunkInput[]=[]
        let total=0
        for(const chunk of chunks) {
          let content:string
          try {content=await this.storage.readChunk(chunk.storageKey,Math.max(1,this.options.maxSourceBytes-total))}
          catch(error){
            if(['AUDIT_CHUNK_TOO_LARGE','ERR_BUFFER_TOO_LARGE'].includes((error as {code?:string}).code ?? ''))throw new AppError('A gravação excede o limite de processamento interativo. Use o arquivo bruto para análise.',413,'AUDIT_SOURCE_TOO_LARGE')
            sources.push({seq:chunk.seq,content:'',unavailable:true});continue
          }
          total+=Buffer.byteLength(content)
          if(total>this.options.maxSourceBytes)throw new AppError('A gravação excede o limite de processamento interativo. Use o arquivo bruto para análise.',413,'AUDIT_SOURCE_TOO_LARGE')
          sources.push({seq:chunk.seq,content})
        }
        const snapshot=reconstructAudit(sources,row.status,row.chunkCount,new Date(this.options.now()))
        snapshot.metadata.id=createHash('sha256').update(`${scope}:${snapshot.metadata.id}`).digest('hex')
        await this.authorize(tenantId,sessionId)
        if(this.store&&row.status!=='RUNNING') {
          try {snapshot.metadata={...await this.store.save(tenantId,sessionId,snapshot),verifiedAt:new Date(this.options.now()).toISOString()}}
          catch {snapshot.metadata.issues.push({code:'PERSISTENCE_UNAVAILABLE',message:'A reconstrução está disponível, mas o histórico e o índice não puderam ser salvos. Tente reprocessar novamente.'})}
        }
        const size=1024+total*2+snapshot.commands.reduce((n,c)=>n+(c.command.length+c.output.length)*2+300,0)+snapshot.events.length*200
        if(size<=this.options.cacheBytes) {
          while((this.bytes+size>this.options.cacheBytes||this.cache.size>=64)&&this.cache.size) {
            const oldest=[...this.cache.keys()][0]
            if(oldest===undefined)break
            this.evict(oldest)
          }
          this.cache.set(scope,{snapshot,key,size,expires:this.options.now()+(row.status==='RUNNING'?this.options.runningTtlMs:this.options.completedTtlMs)})
          this.bytes+=size
        }
        return snapshot
      } finally {const next=this.queue.shift();if(next)next();else this.active--}
    })()
    this.pending.set(scope,{key,promise:work})
    try{return await work}finally{if(this.pending.get(scope)?.promise===work)this.pending.delete(scope)}
  }
  async history(tenantId:number,sessionId:number):Promise<SessionAuditReconstruction[]> {
    await this.authorize(tenantId,sessionId)
    if(!this.store)return []
    try {return await this.store.history(tenantId,sessionId)} catch {throw new AppError('O histórico de reconstruções está indisponível. Confira a migração da instalação e tente novamente.',503,'AUDIT_HISTORY_UNAVAILABLE')}
  }
  async compare(tenantId:number,sessionId:number,id:string): CompareResult {
    const previous=await this.historicalCommands(tenantId,sessionId,id)
    const current=await this.snapshot(tenantId,sessionId)
    let added=0,removed=0,modified=0
    const changes:Array<{index:number;before:string|null;after:string|null;beforeChars:number;afterChars:number;outputChanged:boolean;actorChanged:boolean}>=[]
    for(let i=0;i<Math.max(previous.length,current.commands.length);i++) {
      const before=previous[i],after=current.commands[i]
      if(before?.command===after?.command&&before?.output===after?.output&&before?.actorUserId===after?.actorUserId)continue
      if(!before)added++;else if(!after)removed++;else modified++
      if(changes.length<20)changes.push({index:i+1,before:before?.command.slice(0,2000)??null,after:after?.command.slice(0,2000)??null,beforeChars:before?.command.length??0,afterChars:after?.command.length??0,outputChanged:before?.output!==after?.output,actorChanged:before?.actorUserId!==after?.actorUserId})
    }
    return {previousId:id,currentId:current.metadata.id,added,removed,modified,changes,truncated:added+removed+modified>changes.length}
  }
  async historicalCommands(tenantId:number,sessionId:number,id:string): HistoricalCommandsResult {
    await this.authorize(tenantId,sessionId)
    if(!/^[a-f0-9]{64}$/.test(id))throw new AppError('Versão inválida',400,'INVALID_AUDIT_VERSION')
    const commands=await this.store?.commands(tenantId,sessionId,id)
    if(!commands)throw new AppError('Reconstrução não encontrada',404,'AUDIT_VERSION_NOT_FOUND')
    return commands
  }
}

type CompareResult = Promise<{
    previousId: string;
    currentId: string;
    added: number;
    removed: number;
    modified: number;
    changes: {
        index: number;
        before: string | null;
        after: string | null;
        beforeChars: number;
        afterChars: number;
        outputChanged: boolean;
        actorChanged: boolean;
    }[];
    truncated: boolean;
}>;
type HistoricalCommandsResult = Promise<NonNullable<Awaited<ReturnType<AuditReconstructionStore['commands']>>>>
