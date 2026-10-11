import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
export class TlsError extends Error { constructor(code, message, status=422) { super(message); this.code=code; this.status=status } }
export function metadata(pem) {
  const cert = new X509Certificate(pem)
  return { domain:cert.subject, issuer:cert.issuer, validFrom:cert.validFrom, validTo:cert.validTo, fingerprint:cert.fingerprint256, daysRemaining:Math.floor((Date.parse(cert.validTo)-Date.now())/86400000) }
}
export function validatePair(chain, key, domain) {
  try {
    const certificates=chain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
    if (!certificates?.length || certificates.length>10) throw Error('chain')
    const cert=new X509Certificate(certificates[0]), privateKey=createPrivateKey(key)
    if (!['rsa','ec'].includes(privateKey.asymmetricKeyType)) throw Error('algorithm')
    if (privateKey.asymmetricKeyType==='rsa' && privateKey.asymmetricKeyDetails.modulusLength<2048) throw Error('weak key')
    if (!cert.checkHost(domain,{subject:'never'}) || cert.ca) throw Error('domain')
    if (Date.parse(cert.validFrom)>Date.now() || Date.parse(cert.validTo)<Date.now()+86400000) throw Error('dates')
    const publicDer=createPublicKey(privateKey).export({type:'spki',format:'der'})
    if (!cert.publicKey.export({type:'spki',format:'der'}).equals(publicDer)) throw Error('key')
    for(let i=0;i<certificates.length-1;i++) {
      const parent=new X509Certificate(certificates[i+1]), child=new X509Certificate(certificates[i])
      if(!parent.ca || !child.verify(parent.publicKey)) throw Error('chain')
    }
    return metadata(chain)
  } catch { throw new TlsError('INVALID_CERTIFICATE','Certificado inválido: confira domínio SAN, validade, cadeia e correspondência da chave privada (PEM sem senha).') }
}
export async function run(command,args,options={}) {
  try { return await exec(command,args,{timeout:120000,maxBuffer:1024*1024,...options}) }
  catch (error) {
    if(command==='certbot')throw classifyAcmeError(error)
    if(command==='openssl')throw new TlsError('CHAIN_UNTRUSTED','Não foi possível validar a cadeia de confiança. Confira intermediárias e a CA confiável na instalação.')
    throw new TlsError('COMMAND_FAILED','A operação de certificados falhou. Confira a configuração do serviço.')
  }
}

// Only fixed messages and parsed dates leave this boundary; never return raw Certbot output.
export function classifyAcmeError(error, now = Date.now()) {
  const text = String(error?.stderr || '') + '\n' + String(error?.stdout || '')
  let code = 'ACME_FAILED', message = 'A operação ACME falhou. Confira os diagnósticos do serviço.'
  if (/rateLimited|too many|retry.after/i.test(text)) {code='ACME_RATE_LIMIT';message='A autoridade certificadora limitou as solicitações. Aguarde a próxima tentativa indicada.'}
  else if (/DNS problem|NXDOMAIN|SERVFAIL|no valid [A]+ records/i.test(text)) {code='ACME_DNS';message='A autoridade não conseguiu resolver o domínio. Confira os registros DNS públicos.'}
  else if (/unauthorized|Invalid response|Type:\s*connection|Fetching http:/i.test(text)) {code='ACME_CHALLENGE';message='A autoridade não conseguiu validar o desafio HTTP-01. Confira DNS público, NAT, proxy e acesso externo à porta 80.'}
  else if (error?.killed || /timed? ?out|timeout/i.test(text)) {code='ACME_TIMEOUT';message='A comunicação ACME excedeu o tempo limite. Uma nova tentativa será programada quando a renovação automática estiver ativa.'}
  else if (/connection|network|resolve|unreachable|temporarily unavailable/i.test(text)) {code='ACME_NETWORK';message='Não foi possível comunicar com a autoridade certificadora. Confira a conectividade de saída.'}
  const result = new TlsError(code, message)
  // Certbot versions expose Retry-After either as an HTTP header or a UTC date in the error.
  const match = text.match(/retry.after[:\s]+([^\r\n]+)/i)
  if (match) {
    const raw = match[1].trim(), iso = raw.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2}| UTC)?/)
    let dateText = iso ? iso[0].replace(' UTC','Z').replace(' ','T') : raw
    if(iso && !/(Z|[+-]\d{2}:?\d{2})$/.test(dateText))dateText += 'Z'
    const date = /^\d+$/.test(raw) ? now + Number(raw) * 1000 : Date.parse(dateText)
    if (Number.isFinite(date) && date > now && date < 8640000000000000) result.retryAfter = new Date(date).toISOString()
  }
  return result
}
