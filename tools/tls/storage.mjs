import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TlsError } from './certificates.mjs'

export function storageError(error) {
  const code = ['ENOSPC','EDQUOT'].includes(error?.code) ? 'STORAGE_FULL' : error?.code === 'EROFS' ? 'STORAGE_READ_ONLY' : 'STORAGE_FAILED'
  return new TlsError(code, 'Não foi possível persistir o estado dos certificados. Verifique espaço, permissões e integridade do volume antes de continuar.', 503)
}
export async function syncDirectory(dir, io = fs) {
  const handle = await io.open(dir, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
export async function durableWrite(file, data, io = fs, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await io.open(temporary, 'wx', mode)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close(); handle = null
    await io.rename(temporary, file)
    await syncDirectory(path.dirname(file), io)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await io.unlink(temporary).catch(() => {})
    throw storageError(error)
  }
}
export class StateStore {
  constructor(dir, io = fs) { this.dir = dir; this.io = io; this.file = path.join(dir, 'state.json') }
  async load() {
    try {
      const value = JSON.parse(await this.io.readFile(this.file, 'utf8'))
      if (!value || !['provided','automatic','external'].includes(value.mode) || !Array.isArray(value.history)) throw Error('invalid state')
      const validJob = job => job && typeof job==='object' && typeof job.id==='string' && ['running','succeeded','failed'].includes(job.status)
      if(value.history.some(job=>!validJob(job)) || (value.job && !validJob(value.job)))throw Error('invalid jobs')
      if(value.requests!==undefined && (!value.requests || typeof value.requests!=='object' || Array.isArray(value.requests) || Object.values(value.requests).some(record=>!record || typeof record.actor!=='string' || !/^[a-f0-9]{64}$/.test(record.digest) || !Number.isFinite(Date.parse(record.expiresAt)) || !validJob(record.job))))throw Error('invalid requests')
      if(value.outbox!==undefined && (!Array.isArray(value.outbox) || value.outbox.some(event=>!event || !/^[a-f0-9-]{36}$/i.test(event.id) || !['operation.completed','alerts.changed'].includes(event.type) || !event.data)))throw Error('invalid events')
      if (value.pending && (!/^versions\/[a-zA-Z0-9-]+$/.test(value.pending.previous) || typeof value.pending.fingerprint !== 'string')) throw Error('invalid journal')
      return value
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new TlsError('STATE_CORRUPT', 'O estado persistido está ilegível. O certificado permanece no disco; recupere o estado pelo servidor.', 503)
    }
  }
  save(value) { return durableWrite(this.file, JSON.stringify(value), this.io) }
}
