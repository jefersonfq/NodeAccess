#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const {
  parseEnv,
  exitCodeFor,
  runWarmupWithRetries,
  safeSummary,
  signDevelopmentJwt,
} = require('./dev-warmup-lib.cjs')

const root = path.resolve(__dirname, '..', '..')
const envPath = process.env.BACKEND_ENV_PATH || path.join(root, 'apps/backend/.env')
const fileEnv = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {}
const jwtSecret = process.env.JWT_SECRET || fileEnv.JWT_SECRET
const frontendBase = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE || 'http://127.0.0.1:3000/api/v1'
const strict = process.env.DEV_WARMUP_STRICT === '1'

async function main() {
  const token = signDevelopmentJwt({
    sub: process.env.ADMIN_USER_ID || '1',
    email: process.env.ADMIN_EMAIL || 'admin@nodeaccess.local',
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: Number(process.env.TENANT_ID || '1'),
    canManageHosts: true,
    canViewLiveSessions: true,
    forcePasswordChange: false,
    stage: 'authenticated',
  }, jwtSecret)
  const report = await runWarmupWithRetries({
    frontendBase,
    apiBase,
    token,
    timeoutMs: Number(process.env.DEV_WARMUP_TIMEOUT_MS || '5000'),
  })
  console.log(`[dev-warmup] ${safeSummary(report)}`)
  process.exitCode = exitCodeFor(report, strict)
}

main().catch((error) => {
  console.error(`[dev-warmup] ${error instanceof Error ? error.message : 'Falha desconhecida'}`)
  if (strict) process.exitCode = 1
})
