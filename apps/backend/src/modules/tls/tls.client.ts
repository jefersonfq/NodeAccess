import http from 'node:http'
import { AppError } from '../../shared/errors.js'
export interface TlsTransport { request(method: 'GET'|'POST', path:string, body?:unknown, actor?:string):Promise<unknown> }
export class TlsClient implements TlsTransport {
  constructor(private readonly socket = process.env.TLS_CONTROL_SOCKET) {}
  async request(method:'GET'|'POST',path:string,body?:unknown,actor?:string):Promise<unknown> {
    if(!this.socket) throw new AppError('Gestão de certificados não instalada neste servidor. Consulte o guia de HTTPS.',503,'TLS_NOT_CONFIGURED')
    return new Promise((resolve,reject)=>{
      const req=http.request({socketPath:this.socket,path,method,headers:{'Content-Type':'application/json','X-NodeAccess-Actor':actor||'api'}},res=>{
        res.on('aborted',()=>reject(new AppError('Resposta interrompida do serviço de certificados.',503,'TLS_UNAVAILABLE')))
        res.on('error',()=>reject(new AppError('Falha de comunicação com o serviço de certificados.',503,'TLS_UNAVAILABLE')))
        let data='';res.on('data',chunk=>{data+=chunk;if(data.length>250000)req.destroy(new Error('Oversized TLS service response'))});res.on('end',()=>{
          try {const result=JSON.parse(data);if((res.statusCode||500)>=400)reject(new AppError(result.message,res.statusCode,result.code));else resolve(result)}
          catch{reject(new AppError('Resposta inválida do serviço de certificados.',502,'TLS_UNAVAILABLE'))}
        })
      })
      req.setTimeout(5000,()=>req.destroy(new Error('TLS service timeout')))
      req.on('error',()=>reject(new AppError('Serviço de certificados indisponível. Tente atualizar o estado.',503,'TLS_UNAVAILABLE')))
      req.end(body===undefined?undefined:JSON.stringify(body))
    })
  }
}
