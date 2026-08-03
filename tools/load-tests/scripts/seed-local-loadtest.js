#!/usr/bin/env node

require('dotenv').config({ path: 'apps/backend/.env' })

const fs = require('node:fs')
const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const USER_COUNT = Number(process.env.LOADTEST_USER_COUNT || 10)
const HOST_COUNT = Number(process.env.LOADTEST_HOST_COUNT || USER_COUNT)
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

async function upsertUserByTenantEmail(data) {
  const existing = await prisma.user.findFirst({
    where: {
      tenantId: data.tenantId,
      email: data.email,
      deletedAt: null,
    },
  })

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.user.create({ data })
}

async function upsertInventoryFolder(data) {
  const existing = await prisma.inventoryNode.findFirst({
    where: {
      tenantId: data.tenantId,
      parentId: data.parentId,
      name: data.name,
      type: 'FOLDER',
      deletedAt: null,
    },
  })

  if (existing) {
    return prisma.inventoryNode.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.inventoryNode.create({ data })
}

async function upsertHostInventoryNode(data) {
  const existing = await prisma.inventoryNode.findFirst({
    where: {
      tenantId: data.tenantId,
      hostId: data.hostId,
      deletedAt: null,
    },
  })

  if (existing) {
    return prisma.inventoryNode.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.inventoryNode.create({ data })
}

async function upsertRoleAcl(data) {
  const existing = await prisma.resourceAclEntry.findFirst({
    where: {
      tenantId: data.tenantId,
      inventoryNodeId: data.inventoryNodeId,
      principalType: data.principalType,
      principalId: data.principalId,
    },
  })

  if (existing) {
    return prisma.resourceAclEntry.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.resourceAclEntry.create({ data })
}

async function main() {
  if (!Number.isFinite(USER_COUNT) || USER_COUNT < 1) {
    throw new Error('LOADTEST_USER_COUNT must be greater than zero')
  }
  if (!Number.isFinite(HOST_COUNT) || HOST_COUNT < 1) {
    throw new Error('LOADTEST_HOST_COUNT must be greater than zero')
  }

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
      maxActiveSessionsTenant: Math.max(1000, Number(process.env.LOADTEST_MAX_ACTIVE_SESSIONS_TENANT || 1000)),
      multiConnect: true,
    },
    create: {
      tenantId: tenant.id,
      active: true,
      maxUsers: Math.max(300, USER_COUNT),
      maxActiveSessionsPerUser: 200,
      maxActiveSessionsTenant: Math.max(1000, Number(process.env.LOADTEST_MAX_ACTIVE_SESSIONS_TENANT || 1000)),
      multiConnect: true,
    },
  })

  const fingerprint = hostKeyFingerprint()
  if (!fingerprint) {
    console.warn('Mock SSH public key not found. Start mock-ssh-server once before seeding to avoid host key prompts.')
  }

  const passwordEncrypted = JSON.stringify(encrypt(SSH_PASSWORD))
  const profile = { users: [], hosts: [] }
  const users = []

  for (let index = 1; index <= USER_COUNT; index += 1) {
    const suffix = String(index).padStart(2, '0')
    const email = `loadtest-${suffix}@nodeaccess.local`
    const user = await upsertUserByTenantEmail({
      name: `Load Test ${suffix}`,
      email,
      role: 'USER',
      tenantId: tenant.id,
      active: true,
      canManageHosts: false,
      forcePasswordChange: false,
      licenseConsumed: true,
    })

    users.push({ user, suffix })

    profile.users.push({
      name: `loadtest-${suffix}`,
      email,
      accessToken: signAccessToken(user, tenant.id),
    })
  }

  const actorId = users[0].user.id
  const rootNode = await prisma.inventoryNode.upsert({
    where: { rootTenantId: tenant.id },
    update: {
      tenantId: tenant.id,
      parentId: null,
      type: 'ROOT',
      hostId: null,
      name: 'Root',
      path: '/',
      depth: 0,
      updatedById: actorId,
      deletedAt: null,
    },
    create: {
      tenantId: tenant.id,
      rootTenantId: tenant.id,
      parentId: null,
      type: 'ROOT',
      hostId: null,
      name: 'Root',
      path: '/',
      depth: 0,
      createdById: actorId,
      updatedById: actorId,
    },
  })

  const loadTestFolder = await upsertInventoryFolder({
    tenantId: tenant.id,
    rootTenantId: null,
    parentId: rootNode.id,
    type: 'FOLDER',
    hostId: null,
    name: 'Load Test',
    path: '/Load Test',
    depth: 1,
    createdById: actorId,
    updatedById: actorId,
    deletedAt: null,
  })

  await upsertRoleAcl({
    tenantId: tenant.id,
    inventoryNodeId: loadTestFolder.id,
    principalType: 'ROLE',
    principalId: 1,
    canView: true,
    canConnect: true,
    canEdit: false,
    canAdmin: false,
    inheritToChildren: true,
    managedByLegacyScope: false,
    createdById: actorId,
  })

  for (let index = 1; index <= HOST_COUNT; index += 1) {
    const suffix = String(index).padStart(4, '0')
    const owner = users[(index - 1) % users.length]
    const host = await upsertHost({
      name: `loadtest-mock-${suffix}`,
      ip: HOST_IP,
      port: HOST_PORT,
      sshUser: SSH_USER,
      authType: 'PASSWORD',
      connectionMode: 'DIRECT',
      passwordEncrypted,
      scope: 'PERSONAL',
      ownerId: owner.user.id,
      groupId: null,
      folderId: null,
      bastionId: null,
      onePasswordRef: null,
      trustedHostKeyFingerprint: fingerprint,
      trustedHostKeyVerifiedAt: fingerprint ? new Date() : null,
      trustedHostKeyVerifiedBy: owner.user.id,
      tenantId: tenant.id,
    })

    await upsertHostInventoryNode({
      tenantId: tenant.id,
      rootTenantId: null,
      parentId: loadTestFolder.id,
      type: 'HOST',
      hostId: host.id,
      name: host.name,
      path: `/Load Test/${host.name}`,
      depth: 2,
      createdById: actorId,
      updatedById: actorId,
      deletedAt: null,
    })

    profile.hosts.push({
      id: host.id,
      name: host.name,
      user: `loadtest-${owner.suffix}`,
      commands: loadTestCommands(),
    })
  }

  fs.mkdirSync('tools/load-tests/data', { recursive: true })
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2))

  console.log(`Tenant: ${tenant.slug} id=${tenant.id}`)
  console.log(`Users: ${profile.users.length}`)
  console.log(`Hosts: ${profile.hosts.length}`)
  console.log(`Inventory folder: ${loadTestFolder.name} id=${loadTestFolder.id}`)
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
