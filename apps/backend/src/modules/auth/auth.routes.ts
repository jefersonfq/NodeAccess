import type { FastifyInstance } from 'fastify'
import {
  LoginSchema,
  VerifyTotpSchema,
  RefreshTokenSchema,
  AuthResponseSchema,
  LoginPendingSchema,
  GoogleLoginSchema,
} from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { AuthController } from './auth.controller.js'
import { requirePlatformAdmin } from '../../shared/guards.js'

const tag            = ['Auth']
const loginBodySchema = zodToJsonSchema(LoginSchema) as any
loginBodySchema.examples = [
  {
    email: 'admin@example.com',
    password: 'senha-temporaria-ou-senha-do-usuario',
  },
]
const tokenResponse  = zodToJsonSchema(AuthResponseSchema)
const refreshResponse = {
  type: 'object',
  required: ['accessToken'],
  properties: {
    accessToken: { type: 'string' },
  },
} as const
const pendingResponse = zodToJsonSchema(LoginPendingSchema)

export async function authRoutes(app: FastifyInstance, controller: AuthController): Promise<void> {
  /** POST /api/v1/auth/lookup-tenant — descobre tenants pelo e-mail (pré-login) */
  app.post('/lookup-tenant', {
    schema: {
      tags: tag,
      summary: 'Buscar organizações pelo e-mail',
      description: 'Retorna os tenants ativos onde o e-mail informado possui conta ativa. Usado no fluxo email-first do login para exibir picker de organização.',
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            tenants: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  slug: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    handler: controller.lookupTenant.bind(controller),
  })

  /** POST /api/v1/auth/login — passo 1: valida e-mail e senha */
  app.post('/login', {
    schema: {
      tags: tag,
      summary: 'Login — passo 1 (e-mail e senha)',
      description: 'Valida credenciais locais e retorna estado pendente para MFA/TOTP quando a senha estiver correta. Nao emite access token completo neste passo quando MFA for exigido.',
      body: loginBodySchema,
      response: { 200: pendingResponse },
    },
    handler: controller.login.bind(controller),
  })

  /** POST /api/v1/auth/setup-totp — retorna QR code para primeiro acesso */
  app.post('/setup-totp', {
    schema: {
      tags: tag,
      summary: 'Iniciar setup de MFA (retorna QR code)',
      description: 'Inicia o cadastro de TOTP para usuario em primeiro acesso ou fluxo de configuracao de MFA usando setupToken temporario.',
      body: {
        type: 'object',
        required: ['setupToken'],
        properties: {
          setupToken: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            qrCode:     { type: 'string', description: 'URI otpauth para o app autenticador' },
            setupToken: { type: 'string' },
          },
        },
      },
    },
    handler: controller.setupTotp.bind(controller),
  })

  /** POST /api/v1/auth/confirm-totp — confirma setup de MFA e emite tokens */
  app.post('/confirm-totp', {
    schema: {
      tags: tag,
      summary: 'Confirmar setup de MFA e emitir tokens',
      description: 'Confirma o codigo TOTP durante o setup inicial de MFA e emite tokens de sessao quando o codigo for valido.',
      body: zodToJsonSchema(VerifyTotpSchema),
      response: { 200: tokenResponse },
    },
    handler: controller.confirmTotp.bind(controller),
  })

  /** POST /api/v1/auth/verify-totp — passo 2: valida TOTP e emite tokens */
  app.post('/verify-totp', {
    schema: {
      tags: tag,
      summary: 'Verificar TOTP — passo 2 (emite tokens)',
      description: 'Valida TOTP no segundo passo do login e emite access token e refresh token para uso autenticado na API.',
      body: zodToJsonSchema(VerifyTotpSchema),
      response: { 200: tokenResponse },
    },
    handler: controller.verifyTotp.bind(controller),
  })

  /** POST /api/v1/auth/refresh — renova access token */
  app.post('/refresh', {
    schema: {
      tags: tag,
      summary: 'Renovar access token via refresh token',
      description: 'Renova somente o access token usando refresh token valido. Use quando o access token expirar sem repetir login e MFA.',
      body: zodToJsonSchema(RefreshTokenSchema),
      response: { 200: refreshResponse },
    },
    handler: controller.refresh.bind(controller),
  })

  /** POST /api/v1/auth/logout — revoga refresh token */
  app.post('/logout', {
    schema: {
      tags: tag,
      summary: 'Logout — revogar refresh token',
      description: 'Revoga o refresh token informado e encerra a capacidade de renovar sessao a partir dele.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
      response: { 204: { type: 'null', description: 'Logout realizado com sucesso' } },
    },
    handler: controller.logout.bind(controller),
  })

  /** POST /api/v1/auth/request-email-otp — solicita OTP por email (recuperação MFA) */
  app.post('/request-email-otp', {
    schema: {
      tags: tag,
      summary: 'Solicitar código OTP por email (recuperação MFA)',
      description: 'Solicita envio de codigo OTP por email para recuperacao controlada do fluxo MFA, quando o tenant possui email configurado.',
      body: {
        type: 'object',
        required: ['tempToken'],
        properties: { tempToken: { type: 'string' } },
      },
      response: { 204: { type: 'null' } },
    },
    handler: controller.requestEmailOtp.bind(controller),
  })

  /** POST /api/v1/auth/verify-email-otp — verifica OTP e emite tokens */
  app.post('/verify-email-otp', {
    schema: {
      tags: tag,
      summary: 'Verificar OTP por email e emitir tokens de sessão',
      description: 'Valida codigo OTP recebido por email e emite tokens de sessao como alternativa governada ao TOTP.',
      body: {
        type: 'object',
        required: ['code', 'tempToken'],
        properties: {
          code:      { type: 'string', minLength: 6, maxLength: 6 },
          tempToken: { type: 'string' },
        },
      },
      response: { 200: zodToJsonSchema(AuthResponseSchema) },
    },
    handler: controller.verifyEmailOtp.bind(controller),
  })

  /** GET /api/v1/auth/google/config — config pública do Google SSO (sem auth) */
  app.get('/google/config', {
    schema: {
      tags: tag,
      summary: 'Retorna config pública do Google SSO para o tenant',
      description: 'Retorna apenas dados publicos necessarios para o frontend exibir ou iniciar login com Google SSO.',
      response: {
        200: {
          type: 'object',
          properties: {
            enabled:  { type: 'boolean' },
            clientId: { type: 'string', nullable: true },
          },
        },
      },
    },
    handler: controller.googleConfig.bind(controller),
  })

  /** POST /api/v1/auth/google — login via Google ID token */
  app.post('/google', {
    schema: {
      tags: tag,
      summary: 'Login via Google SSO (ID token)',
      description: 'Valida ID token do Google, aplica politica de dominio/provisionamento do tenant e emite tokens quando autorizado.',
      body:     zodToJsonSchema(GoogleLoginSchema),
      response: { 200: tokenResponse },
    },
    handler: controller.googleLogin.bind(controller),
  })

  app.post<{ Body: { tenantId: number } }>('/platform/enter-tenant', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Entrar em tenant como admin da plataforma',
      description: 'Permite que platform admin assuma contexto administrativo de um tenant especifico para suporte ou gestao controlada.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['tenantId'],
        properties: { tenantId: { type: 'integer' } },
      },
      response: {
        200: {
          type: 'object',
          required: ['accessToken', 'tenant'],
          properties: {
            accessToken: { type: 'string' },
            tenant: {
              type: 'object',
              required: ['id', 'name', 'slug'],
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                slug: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: controller.enterTenant.bind(controller),
  })

  app.post<{ Body: { tenantId: number } }>('/platform/exit-tenant', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Sair do modo de gestao de tenant',
      description: 'Encerra o contexto de gestao de tenant assumido por platform admin.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['tenantId'],
        properties: { tenantId: { type: 'integer' } },
      },
      response: { 204: { type: 'null' } },
    },
    handler: controller.exitTenant.bind(controller),
  })
}
