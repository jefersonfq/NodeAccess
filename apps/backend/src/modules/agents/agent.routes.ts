import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { AgentController } from './agent.controller.js'
import { createReadStream, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const tag = ['Agents']

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Binários ficam em apps/agent/dist/ — resolvido relativo a este arquivo para
// não depender do cwd do processo em monorepo/dev/prod.
const AGENT_DIST = resolve(__dirname, '../../../../agent/dist')

const BINARY_MAP: Record<string, { file: string; mime: string; download: string }> = {
  windows: { file: 'nodeaccess-agent-win.exe',  mime: 'application/octet-stream', download: 'nodeaccess-agent.exe'     },
  linux:   { file: 'nodeaccess-agent-linux',     mime: 'application/octet-stream', download: 'nodeaccess-agent-linux'   },
  macos:   { file: 'nodeaccess-agent-macos',     mime: 'application/octet-stream', download: 'nodeaccess-agent-macos'   },
}

export async function agentRoutes(app: FastifyInstance, ctrl: AgentController): Promise<void> {
  app.get('/', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Listar agentes do usuário', security: [{ bearerAuth: [] }] },
    handler: ctrl.list.bind(ctrl),
  })

  app.post('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Criar agente', security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1 } },
      },
    },
    handler: ctrl.create.bind(ctrl),
  })

  app.delete('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Revogar agente', security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      },
    },
    handler: ctrl.revoke.bind(ctrl),
  })

  app.get('/downloads', {
    schema: {
      tags: tag,
      summary: 'Listar binários do agente publicados no servidor',
    },
    handler: async (_req, reply) => {
      const downloads = Object.entries(BINARY_MAP).map(([platform, entry]) => {
        const filePath = resolve(AGENT_DIST, entry.file)
        return {
          platform,
          fileName: entry.download,
          available: existsSync(filePath),
          downloadUrl: `/api/v1/agents/download/${platform}`,
        }
      })

      return reply.send(downloads)
    },
  })

  // ── Download binário do agente (público — sem auth) ─────────────────────────
  app.get('/download/:platform', {
    schema: {
      tags: tag,
      summary: 'Baixar binário do agente para o sistema operacional',
      params: {
        type: 'object',
        properties: { platform: { type: 'string', enum: ['windows', 'linux', 'macos'] } },
        required: ['platform'],
      },
    },
    handler: async (req, reply) => {
      const { platform } = req.params as { platform: string }
      const entry = BINARY_MAP[platform]
      if (!entry) return reply.status(400).send({ error: 'Plataforma inválida' })

      const filePath = resolve(AGENT_DIST, entry.file)
      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: 'Binário ainda não compilado. Execute npm run build:all em apps/agent/' })
      }

      return reply
        .header('Content-Disposition', `attachment; filename="${entry.download}"`)
        .header('Content-Type', entry.mime)
        .send(createReadStream(filePath))
    },
  })
}
