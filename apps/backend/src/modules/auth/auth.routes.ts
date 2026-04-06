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

const tag            = ['Auth']
const tokenResponse  = zodToJsonSchema(AuthResponseSchema)
const pendingResponse = zodToJsonSchema(LoginPendingSchema)

export async function authRoutes(app: FastifyInstance, controller: AuthController): Promise<void> {
  /** POST /api/v1/auth/login — passo 1: valida e-mail e senha */
  app.post('/login', {
    schema: {
      tags: tag,
      summary: 'Login — passo 1 (e-mail e senha)',
      body: zodToJsonSchema(LoginSchema),
      response: { 200: pendingResponse },
    },
    handler: controller.login.bind(controller),
  })

  /** POST /api/v1/auth/setup-totp — retorna QR code para primeiro acesso */
  app.post('/setup-totp', {
    schema: {
      tags: tag,
      summary: 'Iniciar setup de MFA (retorna QR code)',
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
      body: zodToJsonSchema(RefreshTokenSchema),
      response: { 200: tokenResponse },
    },
    handler: controller.refresh.bind(controller),
  })

  /** POST /api/v1/auth/logout — revoga refresh token */
  app.post('/logout', {
    schema: {
      tags: tag,
      summary: 'Logout — revogar refresh token',
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

  /** GET /api/v1/auth/google/config — config pública do Google SSO (sem auth) */
  app.get('/google/config', {
    schema: {
      tags: tag,
      summary: 'Retorna config pública do Google SSO para o tenant',
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
      body:     zodToJsonSchema(GoogleLoginSchema),
      response: { 200: tokenResponse },
    },
    handler: controller.googleLogin.bind(controller),
  })
}
