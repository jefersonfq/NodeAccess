import { createHash } from 'node:crypto'

export const MAX_BODY = 8192
export interface Header { version:number; type:number; sequence:number; flags:number; sessionId:number; length:number }
export function readHeader(data:Buffer):Header {
  if(data.length<12) throw new Error('Short header')
  const h={version:data[0]!,type:data[1]!,sequence:data[2]!,flags:data[3]!,sessionId:data.readUInt32BE(4),length:data.readUInt32BE(8)}
  if(![0xc0,0xc1].includes(h.version)||![1,2,3].includes(h.type)||h.sequence%2!==1||h.sequence>5||h.flags&~4||h.length>MAX_BODY) throw new Error('Unsupported header')
  if(h.type!==1 && h.version!==0xc0) throw new Error('Invalid version')
  return h
}
// RFC 8907 legacy body obfuscation, NOT transport encryption. Deploy on protected management networks.
export function cryptBody(h:Header, body:Buffer, secret:string):Buffer {
  const prefix=Buffer.alloc(4);prefix.writeUInt32BE(h.sessionId)
  let pad=Buffer.alloc(0),previous=Buffer.alloc(0)
  while(pad.length<body.length) {
    previous=createHash('md5').update(Buffer.concat([prefix,Buffer.from(secret),Buffer.from([h.version,h.sequence]),previous])).digest()
    pad=Buffer.concat([pad,previous])
  }
  return Buffer.from(body.map((v,i)=>v^pad[i]!))
}
export function reply(h:Header,body:Buffer,secret:string):Buffer {
  const next={...h,sequence:h.sequence+1,flags:0,length:body.length}
  const header=Buffer.alloc(12);header[0]=next.version;header[1]=next.type;header[2]=next.sequence;header.writeUInt32BE(next.sessionId,4);header.writeUInt32BE(body.length,8)
  return Buffer.concat([header,cryptBody(next,body,secret)])
}
function strings(body:Buffer,offset:number,lengths:number[]):string[] {
  if(offset+lengths.reduce((a,b)=>a+b,0)!==body.length) throw new Error('Invalid lengths')
  return lengths.map(length=>{const value=body.subarray(offset,offset+length).toString('utf8');offset+=length;if(/[\x00-\x1f\x7f\ufffd]/.test(value))throw new Error('Invalid text');return value})
}
export function authStart(body:Buffer) {
  if(body.length<8)throw new Error('Short start')
  const [username,, ,password]=strings(body,8,[body[4]!,body[5]!,body[6]!,body[7]!])
  return {action:body[0],type:body[2],service:body[3],username:username!,password:password!}
}
export function authContinue(body:Buffer):string {
  if(body.length<5 || body[4]!==0)throw new Error('Aborted authentication')
  return strings(body,5,[body.readUInt16BE(0),body.readUInt16BE(2)])[0]!
}
export function authReply(status:number,message=''):Buffer {
  const text=Buffer.from(message);const fixed=Buffer.alloc(6);fixed[0]=status;fixed[1]=status===5?1:0;fixed.writeUInt16BE(text.length,2)
  return Buffer.concat([fixed,text])
}
export function requestArgs(body:Buffer,accounting=false) {
  const start=accounting?1:0
  if(body.length<start+8)throw new Error('Short request')
  const count=body[start+7]!
  if(count>64||body.length<start+8+count)throw new Error('Too many arguments')
  const lengths=[body[start+4]!,body[start+5]!,body[start+6]!,...body.subarray(start+8,start+8+count)]
  const [username,port,remoteAddress,...args]=strings(body,start+8+count,lengths)
  if(!username||username.length>64)throw new Error('Invalid identity')
  return {username,port:port!,remoteAddress:remoteAddress!,args,flags:accounting?body[0]!:0}
}
export function authorizationReply(status:number):Buffer {return Buffer.from([status,0,0,0,0,0])}
export function accountingReply(status:number):Buffer {return Buffer.from([0,0,0,0,status])}
