import { validateTacacsCrl } from './tacacs-crl.js'
import { readFileSync } from 'node:fs'
import { constants, X509Certificate } from 'node:crypto'
import { createSecureContext, type TlsOptions } from 'node:tls'

export interface TacacsTlsMaterial { key: Buffer; cert: Buffer; ca: Buffer; crl: Buffer }

export function tacacsTlsOptions(material: TacacsTlsMaterial): TlsOptions {
  for (const value of [material.key, material.cert, material.ca, material.crl]) {
    if (!Buffer.isBuffer(value) || !value.length) throw new Error('TACACS+ TLS key, certificate, CA and CRL are required')
  }
  const parse = (pem: Buffer): X509Certificate[] => {
    const blocks = pem.toString().match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
    if (!blocks?.length) throw new Error('TACACS+ TLS certificate PEM is required')
    return blocks.map(block => new X509Certificate(block))
  }
  const chain = parse(material.cert), authorities = parse(material.ca), certificate = chain[0]!
  const now = Date.now()
  for (const item of [...chain, ...authorities]) {
    if (now < Date.parse(item.validFrom) || now > Date.parse(item.validTo)) throw new Error('TACACS+ TLS certificate outside validity period')
  }
  if (certificate.ca || authorities.some(authority => !authority.ca) || chain.slice(1).some(item => !item.ca) || !certificate.keyUsage?.includes('1.3.6.1.5.5.7.3.1')) {
    throw new Error('TACACS+ TLS requires a serverAuth leaf and a CA certificate')
  }
  const options: TlsOptions = { ...material, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
    requestCert: true, rejectUnauthorized: true, secureOptions: constants.SSL_OP_NO_TICKET }
  createSecureContext(options)
  validateTacacsCrl(material.ca, material.crl)
  return options
}

export function loadTacacsTls(environment: Record<string, string | undefined>): TacacsTlsMaterial {
  const read = (name: string): Buffer => {
    const file = environment[name]
    if (!file) throw new Error(`Set ${name} to a readable PEM file`)
    try { return readFileSync(file) } catch { throw new Error(`Cannot read ${name}`) }
  }
  const material = { key: read('NODEACCESS_TACACS_TLS_KEY_FILE'), cert: read('NODEACCESS_TACACS_TLS_CERT_FILE'),
    ca: read('NODEACCESS_TACACS_TLS_CA_FILE'), crl: read('NODEACCESS_TACACS_TLS_CRL_FILE') }
  return material
}
