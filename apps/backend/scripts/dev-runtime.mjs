import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { parse } from 'dotenv'

export const backendDirectory = fileURLToPath(new URL('../', import.meta.url))

export function loadDevelopmentEnvironment(inherited = process.env) {
  const path = resolve(backendDirectory, inherited.NODEACCESS_DEV_ENV_FILE || '.env')
  let local
  try {
    local = parse(readFileSync(path))
  } catch {
    throw new Error('Arquivo de desenvolvimento ausente ou ilegível. Configure apps/backend/.env ou NODEACCESS_DEV_ENV_FILE.')
  }
  if (!local.DATABASE_URL) throw new Error('Defina DATABASE_URL no arquivo de desenvolvimento; para o MySQL local, use 127.0.0.1:3306.')
  return { ...inherited, ...local }
}

export function checkDevelopmentDatabase(environment, connect = createConnection, timeoutMs = 3000) {
  let url
  try {
    url = new URL(environment.DATABASE_URL)
    if (url.protocol !== 'mysql:' || !url.hostname) throw new Error()
  } catch {
    throw new Error('DATABASE_URL inválida no arquivo de desenvolvimento (esperado mysql://).')
  }
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port || 3306) })
    const finish = (error) => {
      socket.destroy()
      if (error) reject(new Error(`MySQL inacessível (${error}). Verifique o container e DATABASE_URL no arquivo de desenvolvimento; fora do Docker, use 127.0.0.1 e a porta publicada, em vez do nome mysql.`))
      else resolve()
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish())
    socket.once('error', error => finish(error.code || 'conexão recusada'))
    socket.once('timeout', () => finish('timeout'))
  })
}
