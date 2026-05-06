#!/usr/bin/env node

require('dotenv').config({ path: 'apps/backend/.env' })

const fs = require('node:fs')
const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const USER_COUNT = Number(process.env.LOADTEST_USER_COUNT || 10)
const HOST_PORT = Number(process.env.LOADTEST_SSH_PORT || process.env.MOCK_SSH_PORT || 2222)
const HOST_IP = process.env.LOADTEST_SSH_HOST || process.env.MOCK_SSH_HOST || '127.0.0.1'
const SSH_USER = process.env.MOCK_SSH_USER || 'loadtest'
const SSH_PASSWORD = process.env.MOCK_SSH_PASSWORD || 'loadtest'
const PROFILE_PATH = process.env.LOADTEST_PROFILE || 'tools/load-tests/data/profile.local.json'
const TENANT_SLUG = process.env.LOADTEST_TENANT_SLUG || 'loadtest'
const TOKEN_EXPIRES_IN = process.env.LOADTEST_TOKEN_EXPIRES_IN || '2h'
const COMMAND_SET = process.env.LOADTEST_COMMAND_SET || 'default'

function encrypt(plaintext) {
  const key = Buffer.from(process.env.PEM_ENCRYPTION_KEY, 'hex')
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    encrypted: Buffer.concat([ciphertext, authTag]).toString('base64'),
    iv: iv.toString('hex'),
  }
}

function hostKeyFingerprint(publicKeyPath = 'tools/load-tests/data/mock-ssh-host-key.pub') {
  if (!fs.existsSync(publicKeyPath)) return null
  const parts = fs.readFileSync(publicKeyPath, 'utf8').trim().split(/\s+/)
  if (parts.length < 2) return null
  return `SHA256:${crypto.createHash('sha256').update(Buffer.from(parts[1], 'base64')).digest('base64')}`
}

function signAccessToken(user, tenantId) {
  return jwt.sign({
    sub: String(user.id),
    email: user.email,
    role: user.role === 'ADMIN' ? 'admin' : 'user',
    isPlatformAdmin: user.isPlatformAdmin,
    tenantId,
    canManageHosts: user.canManageHosts,
    forcePasswordChange: false,
    stage: 'authenticated',
  }, process.env.JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN })
}

function loadTestCommands() {
  if (COMMAND_SET === 'heavy-output') {
    return ['burst 400 80']
  }

  if (COMMAND_SET === 'mixed-output') {
    return ['whoami', 'pwd', 'uptime', 'hostname', 'burst 120 80']
  }

  return ['whoami', 'pwd', 'uptime', 'hostname']
}

async function upsertHost(data) {
  const existing = await prisma.host.findFirst({
    where: {
      tenantId: data.tenantId,
      name: data.name,
    },
  })

  if (existing) {
    return prisma.host.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.host.create({ data })
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { active: true },
    create: { name: 'NodeAccess Load Test', slug: TENANT_SLUG, active: true },
  })

  await prisma.license.upsert({
    where: { tenantId: tenant.id },
    update: {
      active: true,
      maxUsers: Math.max(300, USER_COUNT),
      maxActiveSessionsPerUser: 200,
      maxActiveSessionsTenant: 1000,
      multiConnect: true,
    },
    create: {
      tenantId: tenant.id,
      active: true,
      maxUsers: Math.max(300, USER_COUNT),
      maxActiveSessionsPerUser: 200,
      maxActiveSessionsTenant: 1000,
      multiConnect: true,
    },
  })

  const fingerprint = hostKeyFingerprint()
  if (!fingerprint) {
    console.warn('Mock SSH public key not found. Start mock-ssh-server once before seeding to avoid host key prompts.')
  }

  const passwordEncrypted = JSON.stringify(encrypt(SSH_PASSWORD))
  const profile = { users: [], hosts: [] }

  for (let index = 1; index <= USER_COUNT; index += 1) {
    const suffix = String(index).padStart(2, '0')
    const email = `loadtest-${suffix}@nodeaccess.local`
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        active: true,
        tenantId: tenant.id,
        role: 'USER',
        canManageHosts: false,
        forcePasswordChange: false,
        licenseConsumed: true,
      },
      create: {
        name: `Load Test ${suffix}`,
        email,
        role: 'USER',
        tenantId: tenant.id,
        active: true,
        canManageHosts: false,
        forcePasswordChange: false,
        licenseConsumed: true,
      },
    })

    const host = await upsertHost({
      name: `loadtest-mock-${suffix}`,
      ip: HOST_IP,
      port: HOST_PORT,
      sshUser: SSH_USER,
      authType: 'PASSWORD',
      connectionMode: 'DIRECT',
      passwordEncrypted,
      scope: 'PERSONAL',
      ownerId: user.id,
      groupId: null,
      folderId: null,
      bastionId: null,
      onePasswordRef: null,
      trustedHostKeyFingerprint: fingerprint,
      trustedHostKeyVerifiedAt: fingerprint ? new Date() : null,
      trustedHostKeyVerifiedBy: user.id,
      tenantId: tenant.id,
    })

    profile.users.push({
      name: `loadtest-${suffix}`,
      email,
      accessToken: signAccessToken(user, tenant.id),
    })

    profile.hosts.push({
      id: host.id,
      name: host.name,
      user: `loadtest-${suffix}`,
      commands: loadTestCommands(),
    })
  }

  fs.mkdirSync('tools/load-tests/data', { recursive: true })
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2))

  console.log(`Tenant: ${tenant.slug} id=${tenant.id}`)
  console.log(`Users: ${profile.users.length}`)
  console.log(`Hosts: ${profile.hosts.length}`)
  console.log(`Profile: ${PROFILE_PATH}`)
  console.log(`Target: ${HOST_IP}:${HOST_PORT}`)
  console.log(`Command set: ${COMMAND_SET}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
