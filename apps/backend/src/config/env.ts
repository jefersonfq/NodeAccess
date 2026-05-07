import { z } from 'zod'

const envSchema = z.object({
  // App
  NODE_ENV:         z.enum(['development', 'production', 'test']).default('development'),
  APP_MODE:         z.enum(['api', 'gateway']).default('api'),
  APP_PORT_API:     z.coerce.number().default(3000),
  APP_PORT_GATEWAY: z.coerce.number().default(3001),
  APP_URL:          z.string().url().default('http://localhost'),
  APP_FRONTEND_URL: z.string().url().optional(),
  TRUST_PROXY:      z.coerce.boolean().default(false),
  FEATURE_METRICS:  z.coerce.boolean().default(false),
  FEATURE_MCP:      z.coerce.boolean().default(false),
  METRICS_TOKEN:    z.string().optional(),
  MCP_STATIC_TOKEN: z.string().optional(),
  MCP_STATIC_TENANT_SLUG: z.string().optional(),
  MCP_ALLOWED_CAPABILITIES: z.string().optional(),
  MCP_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  MCP_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  MCP_INTERACTIVE_SSH_DEFAULT_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  MCP_INTERACTIVE_SSH_MAX_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN: z.coerce.number().int().min(1).default(3),
  MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT: z.coerce.number().int().min(1).default(20),
  MCP_INTERACTIVE_SSH_REQUIRE_ALLOWED_HOSTS: z.coerce.boolean().default(false),
  AI_SSH_ACTION_SAFE_COMMAND_PATTERNS: z.string().optional(),
  AI_SSH_ACTION_APPROVAL_COMMAND_PATTERNS: z.string().optional(),
  AI_SSH_ACTION_BLOCKED_COMMAND_PATTERNS: z.string().optional(),

  // Database
  DATABASE_URL: z.string().min(1),
  PRISMA_LOG_QUERIES: z.coerce.boolean().default(false),

  // Redis
  REDIS_URL:      z.string().min(1),
  REDIS_PASSWORD: z.string().optional(),

  // JWT
  JWT_SECRET:             z.string().min(32),
  JWT_EXPIRES_IN:         z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Criptografia (AES-256-GCM) — 64 chars hex = 32 bytes
  PEM_ENCRYPTION_KEY: z.string().length(64),

  // 2FA
  TOTP_ISSUER: z.string().default('SSH Web Platform'),

  // Google SSO (opcional)
  GOOGLE_CLIENT_ID:     z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL:  z.string().url().optional(),

  // Licença
  LICENSE_MAX_USERS: z.coerce.number().default(300),
  LICENSE_KEY:       z.string().optional(),
  LICENSE_MULTI_CONNECT: z.coerce.boolean().default(false),
  SESSION_MAX_ACTIVE_PER_USER: z.coerce.number().optional(),
  SESSION_MAX_ACTIVE_PER_TENANT: z.coerce.number().optional(),

  // Session audit
  FEATURE_SESSION_AUDIT: z.coerce.boolean().default(false),
  FEATURE_SESSION_AUDIT_AI_SUMMARY: z.coerce.boolean().default(false),
  FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY: z.coerce.boolean().default(false),
  FEATURE_LOCAL_AI: z.coerce.boolean().default(false),
  FEATURE_SESSION_AUDIT_GUARDRAILS: z.coerce.boolean().default(false),
  FEATURE_SESSION_AUDIT_TICKET_CONTEXT: z.coerce.boolean().default(false),
  FEATURE_SESSION_AUDIT_TICKET_WRITEBACK: z.coerce.boolean().default(false),
  SESSION_AUDIT_STORAGE_DIR: z.string().default('/tmp/nodeaccess-session-audit'),
  SESSION_AUDIT_CHUNK_MAX_BYTES: z.coerce.number().default(131072),
  SESSION_AUDIT_POLICY_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(30),
  SESSION_AUDIT_AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  SESSION_AUDIT_AI_JOB_STALE_MS: z.coerce.number().int().positive().default(300000),
  SESSION_AUDIT_AI_WORKER_POLL_MS: z.coerce.number().int().positive().default(15000),
  SESSION_AUDIT_AI_WORKER_INITIAL_DELAY_MS: z.coerce.number().int().nonnegative().default(10000),
  GOOGLE_DIRECTORY_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  GOOGLE_DIRECTORY_SYNC_INITIAL_DELAY_MS: z.coerce.number().int().nonnegative().default(30000),

  // Política de senhas
  PASSWORD_MIN_LENGTH:         z.coerce.number().default(8),
  PASSWORD_POLICY_REGEX:       z.string().default('^(?=.*[A-Z])(?=.*\\d).{8,}$'),
  PASSWORD_POLICY_DESCRIPTION: z.string().default('Mínimo 8 caracteres, 1 maiúscula e 1 número'),
})

export type Env = z.infer<typeof envSchema>

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
