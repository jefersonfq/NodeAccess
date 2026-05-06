import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { env } from '../../config/env.js'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

export interface StoredSessionAuditChunk {
  storageKey: string
  compression: string
  rawSize: number
  compressedSize: number
}

export class SessionAuditStorage {
  async writeChunk(sessionId: number, seq: number, content: string): Promise<StoredSessionAuditChunk> {
    const dir = path.join(env.SESSION_AUDIT_STORAGE_DIR, String(sessionId))
    await mkdir(dir, { recursive: true })

    const raw = Buffer.from(content, 'utf-8')
    const compressed = await gzipAsync(raw)

    const filename = `chunk-${String(seq).padStart(6, '0')}.jsonl.gz`
    const fullPath = path.join(dir, filename)
    await writeFile(fullPath, compressed)

    return {
      storageKey: fullPath,
      compression: 'gzip',
      rawSize: raw.length,
      compressedSize: compressed.length,
    }
  }

  async readChunk(storageKey: string): Promise<string> {
    const content = await readFile(storageKey)
    if (storageKey.endsWith('.gz')) {
      return (await gunzipAsync(content)).toString('utf-8')
    }
    return content.toString('utf-8')
  }
}
