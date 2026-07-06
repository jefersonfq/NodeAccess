import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { env } from '../../config/env.js'
import { prisma } from '../../config/database.js'
import { redis } from '../../config/redis.js'
import { requireAdmin } from '../../shared/guards.js'
import { ValidationError } from '../../shared/errors.js'
import {
  NATIVE_SSH_GATEWAY_STATUS_KEY,
  type NativeSshGatewayRuntimeStatus,
} from './native-ssh-gateway.status.js'

const tag = ['NativeSshGateway']

interface NativeSshGatewayConfigRow {
  enabled: boolean | number | bigint
  bindHost: string
  port: number
  publicEndpoint: string | null
  hostKeyPath: string | null
  passwordAuth: boolean | number | bigint
  mfaRequired: boolean | number | bigint
  publicKeyAuth: boolean | number | bigint
}

interface UpdateNativeSshGatewayConfigBody {
  enabled: boolean
  bindHost: string
  port: number
  publicEndpoint: string | null
  hostKeyPath: string | null
  passwordAuth: boolean
  mfaRequired: boolean
  publicKeyAuth: boolean
}

export async function nativeSshGatewayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/config', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Configuração efetiva do Native SSH Gateway',
      description: 'Retorna configuracao salva, fallback por ambiente e status runtime do SSH Gateway nativo.',
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => getConfigResponse(request.jwtUser!.tenantId),
  })

  app.patch<{ Body: UpdateNativeSshGatewayConfigBody }>('/config', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Atualizar configuração administrativa do Native SSH Gateway',
      description: 'Atualiza configuracao administrativa do SSH Gateway nativo para o tenant. Pode exigir restart/reload do runtime conforme deploy.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['enabled', 'bindHost', 'port', 'publicEndpoint', 'hostKeyPath', 'passwordAuth', 'mfaRequired', 'publicKeyAuth'],
        properties: {
          enabled: { type: 'boolean' },
          bindHost: { type: 'string', minLength: 1, maxLength: 255 },
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          publicEndpoint: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
          hostKeyPath: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
          passwordAuth: { type: 'boolean' },
          mfaRequired: { type: 'boolean' },
          publicKeyAuth: { type: 'boolean' },
        },
      },
    },
    handler: async (request) => {
      const input = normalizeInput(request.body)
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO native_ssh_gateway_configs (
          tenant_id,
          enabled,
          bind_host,
          port,
          public_endpoint,
          host_key_path,
          password_auth,
          mfa_required,
          public_key_auth,
          updated_at
        ) VALUES (
          ${request.jwtUser!.tenantId},
          ${input.enabled},
          ${input.bindHost},
          ${input.port},
          ${input.publicEndpoint},
          ${input.hostKeyPath},
          ${input.passwordAuth},
          ${input.mfaRequired},
          ${input.publicKeyAuth},
          NOW(3)
        )
        ON DUPLICATE KEY UPDATE
          enabled = VALUES(enabled),
          bind_host = VALUES(bind_host),
          port = VALUES(port),
          public_endpoint = VALUES(public_endpoint),
          host_key_path = VALUES(host_key_path),
          password_auth = VALUES(password_auth),
          mfa_required = VALUES(mfa_required),
          public_key_auth = VALUES(public_key_auth),
          updated_at = NOW(3)
      `)

      return getConfigResponse(request.jwtUser!.tenantId)
    },
  })
}

async function getConfigResponse(tenantId: number) {
  const saved = await findSavedConfig(tenantId)
  const [activeNativeSshSessions, runtimeStatus] = await Promise.all([
    countActiveNativeSshSessions(tenantId),
    readRuntimeStatus(),
  ])
  const hasSavedConfig = saved !== null
  const desired = saved ?? {
    enabled: env.FEATURE_NATIVE_SSH_GATEWAY,
    bindHost: env.NATIVE_SSH_GATEWAY_HOST,
    port: env.NATIVE_SSH_GATEWAY_PORT,
    publicEndpoint: inferSuggestedEndpoint(),
    hostKeyPath: env.NATIVE_SSH_GATEWAY_HOST_KEY_PATH ?? null,
    passwordAuth: true,
    mfaRequired: true,
    publicKeyAuth: false,
  }

  const effective = {
    enabled: env.FEATURE_NATIVE_SSH_GATEWAY,
    bindHost: env.NATIVE_SSH_GATEWAY_HOST,
    port: env.NATIVE_SSH_GATEWAY_PORT,
    hostKeyConfigured: !!env.NATIVE_SSH_GATEWAY_HOST_KEY_PATH,
    hostKeyPathConfigured: !!env.NATIVE_SSH_GATEWAY_HOST_KEY_PATH,
  }
  const requiresGatewayRestart = desired.enabled !== effective.enabled
    || desired.bindHost !== effective.bindHost
    || desired.port !== effective.port
    || Boolean(desired.hostKeyPath) !== effective.hostKeyConfigured

  return {
    ...desired,
    host: effective.bindHost,
    suggestedEndpoint: desired.publicEndpoint || inferSuggestedEndpoint(),
    appUrl: env.APP_URL,
    configSource: hasSavedConfig ? 'database' : 'env',
    effective,
    operational: {
      appMode: env.APP_MODE,
      processStatusObservable: runtimeStatus !== null,
      processState: runtimeStatus?.state ?? 'unknown',
      runtimeHost: runtimeStatus?.host ?? null,
      runtimePort: runtimeStatus?.port ?? null,
      runtimeStartedAt: runtimeStatus?.startedAt ?? null,
      runtimeLastSeenAt: runtimeStatus?.lastSeenAt ?? null,
      runtimeLastFailureAt: runtimeStatus?.lastFailureAt ?? null,
      runtimeLastFailureMessage: runtimeStatus?.lastFailureMessage ?? null,
      activeNativeSshSessions,
    },
    differsFromEnv: requiresGatewayRestart,
    requiresGatewayRestart,
  }
}

async function readRuntimeStatus(): Promise<NativeSshGatewayRuntimeStatus | null> {
  let raw: string | null
  try {
    raw = await redis.get(NATIVE_SSH_GATEWAY_STATUS_KEY)
  } catch {
    return null
  }

  if (!raw) return null

  try {
    return JSON.parse(raw) as NativeSshGatewayRuntimeStatus
  } catch {
    return null
  }
}

async function findSavedConfig(tenantId: number): Promise<UpdateNativeSshGatewayConfigBody | null> {
  const rows = await prisma.$queryRaw<NativeSshGatewayConfigRow[]>(Prisma.sql`
    SELECT
      enabled,
      bind_host AS bindHost,
      port,
      public_endpoint AS publicEndpoint,
      host_key_path AS hostKeyPath,
      password_auth AS passwordAuth,
      mfa_required AS mfaRequired,
      public_key_auth AS publicKeyAuth
    FROM native_ssh_gateway_configs
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `)

  const row = rows[0]
  if (!row) return null

  return {
    enabled: parseBool(row.enabled),
    bindHost: row.bindHost,
    port: row.port,
    publicEndpoint: row.publicEndpoint,
    hostKeyPath: row.hostKeyPath,
    passwordAuth: parseBool(row.passwordAuth),
    mfaRequired: parseBool(row.mfaRequired),
    publicKeyAuth: parseBool(row.publicKeyAuth),
  }
}

async function countActiveNativeSshSessions(tenantId: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS count
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE u.tenant_id = ${tenantId}
      AND s.active = true
      AND s.connection_method = 'native_ssh_gateway'
  `)

  const count = rows[0]?.count ?? 0
  return typeof count === 'bigint' ? Number(count) : Number(count)
}

function normalizeInput(input: UpdateNativeSshGatewayConfigBody): UpdateNativeSshGatewayConfigBody {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new ValidationError('Porta do SSH Gateway inválida')
  }

  const bindHost = input.bindHost.trim()
  if (!bindHost) throw new ValidationError('Bind host obrigatório')

  return {
    enabled: input.enabled === true,
    bindHost,
    port: input.port,
    publicEndpoint: normalizeNullableString(input.publicEndpoint),
    hostKeyPath: normalizeNullableString(input.hostKeyPath),
    passwordAuth: input.passwordAuth === true,
    mfaRequired: input.mfaRequired === true,
    publicKeyAuth: input.publicKeyAuth === true,
  }
}

function normalizeNullableString(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

function parseBool(value: boolean | number | bigint): boolean {
  return value === true || value === 1 || value === BigInt(1)
}

function inferSuggestedEndpoint(): string {
  try {
    const url = new URL(env.APP_URL)
    return url.hostname
  } catch {
    return 'nodeaccess.example.com'
  }
}
