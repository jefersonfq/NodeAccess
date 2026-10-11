import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { metadata, validatePair, TlsError } from './certificates.mjs'
import { StateStore, durableWrite, syncDirectory, storageError } from './storage.mjs'
import { retryAt, certificateAlerts } from './retry.mjs'

const safe = error => {
  if(['ENOSPC','EDQUOT','EROFS','EACCES','EPERM'].includes(error?.code))error=storageError(error)
  return error instanceof TlsError
    ? {code:error.code, message:error.message, ...(error.retryAfter ? {retryAfter:error.retryAfter} : {})}
    : {code:'TLS_OPERATION_FAILED', message:'Não foi possível concluir a operação. Consulte o diagnóstico e o certificado ativo.'}
}
const requestDigest = (input, actor) => createHash('sha256').update(JSON.stringify([actor, Object.keys(input).sort().map(key => [key,input[key]])])).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const renewalActions = ['automatic','renew']

export class CertificateManager extends EventEmitter {
  constructor({root,stateDir,domain,external=false,adapter,now=()=>Date.now(),store}) {
    super()
    Object.assign(this,{root,stateDir,domain,external,adapter,now})
    this.store = store || new StateStore(stateDir)
    this.state = {mode:external?'external':'provided',history:[],nextCheck:null,requests:{},outbox:[]}
    this.busy = false
    this.runningJobId = null
    this.committedOutbox = []
    this.writes = Promise.resolve()
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw Error('TLS_DOMAIN must be a DNS hostname')
  }
  async init() {
    try {
      await fs.mkdir(this.stateDir,{recursive:true,mode:0o700})
      const stored = await this.store.load()
      if (stored) this.state = {...this.state,...stored}
      this.committedOutbox=structuredClone(this.state.outbox)
    } catch (error) { this.state.storageError = safe(error instanceof TlsError ? error : storageError(error)); this.state.recoveryRequired=true; return }
    if (this.external) this.state.mode='external'
    if (this.state.storageError) {
      try {
        if(this.external)await this.adapter.inspect()
        else {await this.adapter.test();await this.adapter.verify((await this.active())?.fingerprint)}
        delete this.state.storageError
        this.state.recoveryRequired=false
      } catch { this.state.recoveryRequired=true }
    }
    if (this.state.pending) {
      try {
        await this.point(this.state.pending.previous)
        await this.adapter.test()
        await this.adapter.reload()
        await this.adapter.verify(this.state.pending.fingerprint)
        this.state.recoveryRequired=false
        delete this.state.pending
      } catch { this.state.recoveryRequired=true }
    }
    if (this.state.job?.status==='running') {
      this.state.job.status='failed'
      this.state.job.finishedAt=new Date(this.now()).toISOString()
      this.state.job.error={code:'INTERRUPTED',message:'Operação interrompida. Confira o certificado ativo antes de tentar novamente.'}
      this.state.history.unshift({...this.state.job})
      this.rememberJob(this.state.job)
      this.event('operation.completed',this.state.job)
    }
    await this.save().catch(() => {})
  }
  async save() {
    if (this.state.storageError?.code==='STATE_CORRUPT') throw new TlsError('STATE_CORRUPT',this.state.storageError.message,503)
    const snapshot=structuredClone(this.state)
    const write=this.writes.catch(()=>{}).then(()=>this.store.save(snapshot))
    this.writes=write
    try { await write;this.committedOutbox=structuredClone(snapshot.outbox) } catch (error) {
      const failure=error instanceof TlsError ? error : storageError(error)
      this.state.storageError=safe(failure); this.state.recoveryRequired=true
      throw failure
    }
  }
  event(type,data) {
    const event={id:randomUUID(),type,domain:this.domain,occurredAt:new Date(this.now()).toISOString(),data:structuredClone(data)}
    this.state.outbox.push(event)
    return event
  }
  events() { return this.committedOutbox.slice(0,50) }
  publicJob(job) { return job ? {...structuredClone(job),...(job.id===this.runningJobId?{status:'running'}:{})} : null }
  async acknowledge(ids) {
    if (!Array.isArray(ids)||ids.length>50||ids.some(id=>typeof id!=='string'||!uuid.test(id))) throw new TlsError('INVALID_INPUT','Eventos inválidos.',400)
    this.state.outbox=this.state.outbox.filter(event=>!ids.includes(event.id))
    await this.save()
  }
  rememberJob(job) {
    if (job.requestId && this.state.requests[job.requestId]) this.state.requests[job.requestId].job=structuredClone(job)
  }
  operation(id,actor) {
    const record=this.state.requests[id]
    if (!record || record.actor!==actor) throw new TlsError('OPERATION_NOT_FOUND','Operação não encontrada para este administrador.',404)
    return this.publicJob(record.job)
  }
  async point(target) {
    const temporary=path.join(this.root,`.current-${randomUUID()}`)
    try { await fs.symlink(target,temporary); await fs.rename(temporary,path.join(this.root,'current')); await syncDirectory(this.root) }
    catch(error) { await fs.unlink(temporary).catch(()=>{}); throw storageError(error) }
  }
  async active() {
    if(this.external)return null
    try{return metadata(await fs.readFile(path.join(this.root,'current/fullchain.pem'),'utf8'))}catch{return null}
  }
  async status() {
    const active=await this.active()
    return {available:!this.state.storageError,domain:this.domain,externalOnly:this.external,mode:this.state.mode,email:this.state.email||'',active,observed:this.state.observed||null,job:this.publicJob(this.state.job),candidate:this.state.candidate||null,nextCheck:this.state.nextCheck,history:this.state.history.filter(job=>job.id!==this.runningJobId).slice(0,30),recoveryRequired:!!this.state.recoveryRequired,alerts:certificateAlerts(this.state,active||this.state.observed,this.now()),auditPending:this.state.outbox.length,acmeBlockedUntil:this.state.acmeBlockedUntil||null,monitorCheckedAt:this.state.monitorCheckedAt||null}
  }
  validateInput(input) {
    const allowed=['action','certificate','privateKey','candidateId','email','agreeTerms','expectedFingerprint','requestId']
    if(!input || typeof input!=='object' || Object.keys(input).some(key=>!allowed.includes(key)))throw new TlsError('INVALID_INPUT','Dados de operação inválidos.',400)
    if(!['check','simulate','validate','apply','automatic','renew','external','pause'].includes(input.action))throw new TlsError('INVALID_ACTION','Operação inválida.',400)
    if(input.requestId!==undefined && !uuid.test(input.requestId))throw new TlsError('INVALID_REQUEST_ID','Identificador de operação inválido.',400)
    if(this.external && !['check','external'].includes(input.action))throw new TlsError('EXTERNAL_TLS','Este ambiente administra HTTPS no proxy externo.',409)
    if(!this.external && input.action==='external')throw new TlsError('EXTERNAL_SETUP_REQUIRED','Configure a terminação TLS externa no instalador antes de selecionar este modo.',409)
    if(['validate','apply','automatic','pause'].includes(input.action) && typeof input.expectedFingerprint!=='string')throw new TlsError('STALE_STATE','Atualize a tela antes de alterar o certificado.',409)
    if(input.action==='validate' && (typeof input.certificate!=='string'||typeof input.privateKey!=='string'||input.certificate.length>100000||input.privateKey.length>30000))throw new TlsError('INVALID_INPUT','Envie certificado e chave PEM dentro dos limites de tamanho.',400)
    if(input.action==='apply'&&!uuid.test(input.candidateId||''))throw new TlsError('INVALID_CANDIDATE','Valide os arquivos antes de aplicar.',400)
    if(input.action==='automatic'&&(input.agreeTerms!==true||typeof input.email!=='string'||!/^\S+@\S+\.\S+$/.test(input.email)||input.email.length>254))throw new TlsError('ACME_CONSENT','Informe um e-mail válido e aceite os termos do Let’s Encrypt.',400)
    if(['renew','simulate'].includes(input.action)&&this.state.mode!=='automatic')throw new TlsError('NOT_AUTOMATIC','A renovação automática não está habilitada.',409)
    const until=this.state.acmeBlockedUntil
    if (['automatic','renew','simulate'].includes(input.action)&&Date.parse(until||'')>this.now()) {
      const error=new TlsError('ACME_RATE_LIMIT','Aguarde o prazo indicado pela autoridade certificadora antes de tentar novamente.',429)
      error.retryAfter=until;throw error
    }
  }
  async submit(input,actor) {
    // Replay an accepted request before checking changing state (fingerprint, mode, busy).
    if(input?.requestId && this.state.requests[input.requestId]) {
      const previous=this.state.requests[input.requestId]
      if(previous.actor!==actor||previous.digest!==requestDigest(input,actor))throw new TlsError('IDEMPOTENCY_CONFLICT','O identificador já pertence a outra solicitação.',409)
      if(this.admitting===input.requestId)await this.admission
      return this.publicJob(previous.job)
    }
    this.validateInput(input)
    if(this.busy)throw new TlsError('TLS_BUSY','Já existe uma operação em andamento.',409)
    if(this.state.recoveryRequired)throw new TlsError('RECOVERY_REQUIRED','Recuperação pelo servidor necessária antes de novas operações.',409)
    this.busy=true
    try {
      if(input.expectedFingerprint!==undefined&&input.expectedFingerprint!==((await this.active())?.fingerprint||''))throw new TlsError('STALE_STATE','O certificado mudou. Atualize a tela e revise novamente.',409)
      for(const [id,record] of Object.entries(this.state.requests))if(Date.parse(record.expiresAt)<this.now())delete this.state.requests[id]
      if(actor!=='scheduler'&&Object.keys(this.state.requests).length>=1000)throw new TlsError('REQUEST_CAPACITY','Limite de operações retidas atingido. Aguarde a expiração dos registros.',429)
      const job={id:randomUUID(),requestId:input.requestId||randomUUID(),action:input.action,actor,status:'running',startedAt:new Date(this.now()).toISOString(),steps:[]}
      if(actor!=='scheduler')this.state.requests[job.requestId]={actor,digest:requestDigest(input,actor),expiresAt:new Date(this.now()+7*86400000).toISOString(),job:structuredClone(job)}
      this.state.job=job
      this.runningJobId=job.id
      this.admitting=job.requestId
      this.admission=this.save()
      try {await this.admission} catch(error){delete this.state.requests[job.requestId];throw error} finally {this.admitting=null}
      this.completion=this.execute(input).then(result=>{job.status='succeeded';job.result=result},error=>{job.status='failed';job.error=safe(error);if(job.error.code.startsWith('STORAGE_')){this.state.storageError=job.error;this.state.recoveryRequired=true}})
        .then(async()=>{
          if(job.error?.code==='ACME_RATE_LIMIT')this.state.acmeBlockedUntil=job.error.retryAfter||new Date(this.now()+3600000).toISOString()
          if(renewalActions.includes(job.action)) {
            if(job.status==='failed') {
              this.state.renewalFailure=job.error
              this.state.renewalAttempts=(this.state.renewalAttempts||0)+1
              if(this.state.mode==='automatic')this.state.nextCheck=retryAt(job.error,this.state.renewalAttempts,this.now())
            } else { delete this.state.renewalFailure;this.state.renewalAttempts=0;delete this.state.acmeBlockedUntil }
          }
          job.finishedAt=new Date(this.now()).toISOString()
          this.rememberJob(job)
          this.state.history.unshift(structuredClone(job));this.state.history=this.state.history.slice(0,100)
          this.event('operation.completed',job)
          await this.save();await this.cleanup()
          this.emit('completed',structuredClone(job))
        }).catch(error=>{job.status='failed';job.error=safe(error);this.state.recoveryRequired=true;this.rememberJob(job)})
        .finally(()=>{this.busy=false;this.runningJobId=null})
      return this.publicJob(job)
    }catch(error){this.busy=false;this.runningJobId=null;throw error}
  }
  async step(name,operation) {
    const step={name,status:'running',startedAt:new Date(this.now()).toISOString()}
    this.state.job.steps.push(step);this.rememberJob(this.state.job);await this.save()
    try {const value=await operation();step.status='succeeded';return value}
    catch(error){step.status='failed';step.error=safe(error);throw error}
    finally {step.finishedAt=new Date(this.now()).toISOString();this.rememberJob(this.state.job);await this.save()}
  }
  async cleanup() {
    if(this.external)return
    const current=await fs.readlink(path.join(this.root,'current')).catch(()=>'')
    const keep=new Set([path.basename(current),this.state.previousVersion,this.state.candidate?.id,this.state.pending?.previous?.split('/').pop()])
    for(const name of await fs.readdir(path.join(this.root,'versions')).catch(()=>[]))if(!keep.has(name)&&/^(?:[0-9a-f-]{36}|bootstrap)$/.test(name))await fs.rm(path.join(this.root,'versions',name),{recursive:true,force:true})
  }
  async stage(chain,key) {
    const meta=validatePair(chain,key,this.domain),id=randomUUID(),dir=path.join(this.root,'versions',id)
    // The installer creates versions/. Non-recursive mkdir preserves EROFS diagnostics.
    try { await fs.mkdir(dir,{mode:0o700}) } catch(error) { throw storageError(error) }
    try {
      await durableWrite(path.join(dir,'fullchain.pem'),chain)
      await durableWrite(path.join(dir,'privkey.pem'),key)
      await this.step('chain',()=>this.adapter.validateChain(dir,this.domain))
      await syncDirectory(path.dirname(dir))
    }catch(error){await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});throw error}
    this.state.candidate={id,...meta,expiresAt:new Date(this.now()+15*60000).toISOString(),baseFingerprint:(await this.active())?.fingerprint||''}
    return this.state.candidate
  }
  async activate(candidate) {
    if(!candidate||Date.parse(candidate.expiresAt)<this.now())throw new TlsError('CANDIDATE_EXPIRED','A validação expirou. Envie os arquivos novamente.',409)
    if(candidate.baseFingerprint!==((await this.active())?.fingerprint||''))throw new TlsError('STALE_STATE','O certificado ativo mudou. Valide novamente.',409)
    const previous=await fs.readlink(path.join(this.root,'current')),fingerprint=(await this.active())?.fingerprint
    const pending={previous,fingerprint}
    this.state.pending=pending;await this.save()
    let resolved=false
    try {
      await this.point(`versions/${candidate.id}`)
      await this.step('nginx',()=>this.adapter.test())
      await this.step('reload',()=>this.adapter.reload())
      await this.step('verify',()=>this.adapter.verify(candidate.fingerprint));resolved=true
    }catch(error){
      try {await this.point(previous);await this.adapter.test();await this.adapter.reload();await this.adapter.verify(fingerprint);resolved=true}
      catch{this.state.recoveryRequired=true;throw new TlsError('ROLLBACK_FAILED','Falha na aplicação e na verificação da recuperação. Verifique o Nginx pelo servidor.',500)}
      if(this.state.storageError)throw error
      throw new TlsError('APPLY_ROLLED_BACK','A aplicação falhou. O certificado anterior foi restaurado e verificado.',502)
    }finally{
      if(resolved)delete this.state.pending
      try{await this.save()}catch(error){this.state.pending=pending;throw error}
    }
    this.state.previousVersion=path.basename(previous)
    this.state.observed={...candidate,checkedAt:new Date(this.now()).toISOString()};delete this.state.candidate
    return {message:'Certificado aplicado e verificado.',fingerprint:candidate.fingerprint}
  }
  async preflight() {
    if(this.adapter.resolveDns)await this.step('dns',()=>this.adapter.resolveDns())
    if(this.adapter.checkChallenge)await this.step('challenge',()=>this.adapter.checkChallenge())
  }
  async execute(input) {
    switch(input.action){
      case 'check': {
        const observed=await this.step('https',()=>this.adapter.inspect())
        this.state.observed={...observed,checkedAt:new Date(this.now()).toISOString()}
        if(!this.external){await this.step('nginx',()=>this.adapter.test());if(observed.fingerprint!==(await this.active())?.fingerprint)throw new TlsError('TLS_MISMATCH','O certificado servido difere do configurado. Verifique o proxy e a recarga do Nginx.')}
        return {message:'HTTPS verificado. Nenhuma emissão ACME foi solicitada.'}
      }
      case 'simulate': await this.preflight();await this.step('acme',()=>this.adapter.dryRun(this.state.email));return {message:'Simulação ACME concluída. O certificado ativo não foi alterado.'}
      case 'validate': delete this.state.candidate;return {message:'Arquivos validados. Revise e confirme a aplicação.',candidate:await this.stage(input.certificate,input.privateKey)}
      case 'apply': {
        if(this.state.candidate?.id!==input.candidateId)throw new TlsError('INVALID_CANDIDATE','A prévia não está mais disponível. Valide novamente.',409)
        const result=await this.activate(this.state.candidate);this.state.mode='provided';this.state.nextCheck=null;delete this.state.renewalFailure;return result
      }
      case 'automatic':case 'renew': {
        await this.preflight()
        const email=input.action==='automatic'?input.email:this.state.email
        const pair=await this.step('acme',()=>this.adapter.issue(email))
        const candidate=await this.stage(pair.certificate,pair.privateKey)
        let result={message:'Certificado ainda válido; nenhuma recarga necessária.'}
        if(candidate.fingerprint!==(await this.active())?.fingerprint)result=await this.activate(candidate)
        else delete this.state.candidate
        this.state.mode='automatic';this.state.email=email;this.state.nextCheck=new Date(this.now()+12*3600000).toISOString();return result
      }
      case 'pause':this.state.mode='provided';this.state.nextCheck=null;delete this.state.renewalFailure;return {message:'Renovação automática desativada. O certificado atual permanece em uso.'}
      case 'external':this.state.mode='external';this.state.nextCheck=null;return {message:'HTTPS administrado pelo proxy externo.'}
    }
  }
  async monitor() {
    try{const observed=await this.adapter.inspect();this.state.observed={...observed,checkedAt:new Date(this.now()).toISOString()};delete this.state.monitorError}
    catch(error){this.state.monitorError=safe(error)}
    this.state.monitorCheckedAt=new Date(this.now()).toISOString()
    const alerts=certificateAlerts(this.state,(await this.active())||this.state.observed,this.now())
    const signature=JSON.stringify(alerts.map(alert=>[alert.code,alert.severity,alert.daysRemaining<=7?alert.daysRemaining:Math.floor((alert.daysRemaining||0)/7)]))
    if(signature!==this.state.alertSignature){this.state.alertSignature=signature;this.event('alerts.changed',{alerts})}
    await this.save()
  }
  async tick() {
    if(this.busy||this.state.recoveryRequired)return
    this.busy=true
    try{
      if(this.state.candidate&&Date.parse(this.state.candidate.expiresAt)<this.now()){delete this.state.candidate;await this.save();await this.cleanup()}
      if(!this.state.monitorCheckedAt||this.now()-Date.parse(this.state.monitorCheckedAt)>=3600000)await this.monitor()
    }finally{this.busy=false}
    if(this.state.mode!=='automatic'||Date.parse(this.state.nextCheck||0)>this.now())return
    this.state.nextCheck=new Date(this.now()+12*3600000).toISOString()
    await this.submit({action:'renew'},'scheduler')
  }
}
