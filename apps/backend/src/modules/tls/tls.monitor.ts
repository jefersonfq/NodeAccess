import type { PrismaClient, Prisma } from '@prisma/client'
import type { TlsTransport } from './tls.client.js'

type Alert = {code:string; severity:'error'|'warning'; message:string; retryAt?:string}
type WorkerEvent = {id:string;type:string;domain:string;occurredAt:string;data:Record<string,unknown>}
export class TlsMonitor {
  private busy=false
  private stopped=false
  private timer?:ReturnType<typeof setInterval>
  private pending:Promise<void>=Promise.resolve()
  private snapshot:{enabled:boolean;checkedAt:string|null;alerts:Alert[]}={enabled:false,checkedAt:null,alerts:[]}
  constructor(private db:PrismaClient,private client:TlsTransport,private enabled:boolean) {this.snapshot.enabled=enabled}
  status(): { enabled: boolean; checkedAt: string | null; alerts: Alert[]; }{return this.snapshot}
  start(): void{if(!this.enabled)return;this.stopped=false;void this.poll();this.timer=setInterval(()=>void this.poll(),60000);this.timer.unref()}
  async stop(): Promise<void>{this.stopped=true;clearInterval(this.timer);await this.pending}
  async poll(): Promise<void>{
    if(!this.enabled||this.busy||this.stopped)return
    this.busy=true
    this.pending=this.collect().finally(()=>{this.busy=false})
    await this.pending
  }
  private async collect(): Promise<void>{
    try {
      const status=await this.client.request('GET','/status') as {alerts?:Alert[]}
      this.snapshot={enabled:true,checkedAt:new Date().toISOString(),alerts:status.alerts||[]}
    }catch{
      this.snapshot={enabled:true,checkedAt:new Date().toISOString(),alerts:[{code:'TLS_AGENT_UNAVAILABLE',severity:'error',message:'O agente de certificados está indisponível. A renovação automática não pôde ser confirmada.'}]}
      return
    }
    try {
      const response=await this.client.request('GET','/events') as {events:WorkerEvent[]}
      for(const event of response.events){
        if(!/^[0-9a-f-]{36}$/i.test(event.id)||!['operation.completed','alerts.changed'].includes(event.type)||!Number.isFinite(Date.parse(event.occurredAt)))throw Error('Invalid TLS event')
        // Primary-key upsert makes retries safe if the database commit succeeds but ACK is lost.
        await this.db.tlsAuditEvent.upsert({where:{id:event.id},update:{},create:{id:event.id,type:event.type,domain:event.domain,actor:typeof event.data.actor==='string'?event.data.actor:null,occurredAt:new Date(event.occurredAt),details:event.data as Prisma.InputJsonValue}})
      }
      if(response.events.length)await this.client.request('POST','/events/ack',{ids:response.events.map(event=>event.id)})
    }catch{
      this.snapshot.alerts=[...this.snapshot.alerts,{code:'TLS_AUDIT_PENDING',severity:'warning',message:'Há eventos de certificados aguardando sincronização com a auditoria central.'}]
    }
  }
}
