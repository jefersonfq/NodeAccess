import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { AgentController } from './agent.controller.js'
import { createReadStream, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../../config/env.js'

const tag = ['Agents']

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Binários ficam em apps/agent/dist em dev e em /app/agent/dist na imagem prod.
const AGENT_DIST_CANDIDATES = [
  resolve(__dirname, '../../../../agent/dist'),
  resolve(process.cwd(), 'agent/dist'),
  resolve(process.cwd(), 'apps/agent/dist'),
] as const

const BINARY_MAP: Record<string, { file: string; mime: string; download: string }> = {
  windows: { file: 'nodeaccess-agent-win.exe',  mime: 'application/octet-stream', download: 'nodeaccess-agent.exe'     },
  linux:   { file: 'nodeaccess-agent-linux',     mime: 'application/octet-stream', download: 'nodeaccess-agent-linux'   },
  macos:   { file: 'nodeaccess-agent-macos',     mime: 'application/octet-stream', download: 'nodeaccess-agent-macos'   },
}

function resolveAgentBinary(fileName: string): string {
  for (const dir of AGENT_DIST_CANDIDATES) {
    const filePath = resolve(dir, fileName)
    if (existsSync(filePath)) return filePath
  }
  return resolve(AGENT_DIST_CANDIDATES[0]!, fileName)
}

type InstallQuery = { server?: string }

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function resolveInstallServerUrl(req: FastifyRequest<{ Querystring: InstallQuery }>): string {
  const requestedServer = req.query.server?.trim()
  if (requestedServer && isHttpUrl(requestedServer)) return cleanBaseUrl(requestedServer)

  const forwardedProto = firstHeader(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim()
  const forwardedHost = firstHeader(req.headers['x-forwarded-host'])?.split(',')[0]?.trim()
  const host = forwardedHost || firstHeader(req.headers.host)

  if (host) return cleanBaseUrl(`${forwardedProto || 'http'}://${host}`)

  return cleanBaseUrl(env.APP_URL)
}

const installQuerySchema = {
  type: 'object',
  properties: {
    server: { type: 'string' },
  },
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
        properties: {
          name:      { type: 'string', minLength: 1 },
          agentType: { type: 'string', enum: ['PROXY_AGENT', 'PRIVATE_ACCESS_CONNECTOR'] },
          agentMode: { type: 'string', enum: ['USER_BOUND', 'SERVICE_BOUND'] },
          privateAccess: {
            type: 'object',
            additionalProperties: false,
            properties: {
              siteName:         { type: 'string' },
              environment:      { type: 'string' },
              allowedCidrs:     { type: 'array', items: { type: 'string' } },
              allowedHostnames: { type: 'array', items: { type: 'string' } },
              allowedPorts:     { type: 'array', items: { type: 'integer', minimum: 1, maximum: 65535 } },
              allowedHostTags:  { type: 'array', items: { type: 'string' } },
              allowFallback:    { type: 'boolean' },
            },
          },
        },
      },
    },
    handler: ctrl.create.bind(ctrl),
  })

  app.delete('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Revogar agente (bloqueio temporário)', security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    handler: ctrl.revoke.bind(ctrl),
  })

  app.delete('/:id/permanent', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Excluir agente permanentemente (soft delete, preserva auditoria)', security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    handler: ctrl.permanentDelete.bind(ctrl),
  })

  app.post('/:id/reactivate', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Reativar agente revogado', security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    handler: ctrl.reactivate.bind(ctrl),
  })

  app.post('/:id/default', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Marcar agente SERVICE_BOUND como padrão do tenant', security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    handler: ctrl.setDefault.bind(ctrl),
  })

  // ── Status dos agentes disponíveis para o usuário atual ────────────────────
  app.get('/status', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Agentes online disponíveis para o usuário atual (tenant + user-bound)',
      security: [{ bearerAuth: [] }],
    },
    handler: ctrl.status.bind(ctrl),
  })

  // ── Install scripts (públicos — sem auth) ──────────────────────────────────
  app.get<{ Querystring: InstallQuery }>('/install/linux', {
    schema: { tags: tag, summary: 'Script de instalação para Linux (bash)', querystring: installQuerySchema },
    handler: async (req, reply) => {
      const s = resolveInstallServerUrl(req)
      const script = `#!/usr/bin/env bash
set -euo pipefail

SERVER="${s}"
TOKEN=""
INSTALL_SERVICE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)   TOKEN="$2";          shift 2 ;;
    --service) INSTALL_SERVICE=true; shift   ;;
    *)         shift ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "Uso: bash <(curl -fsSL $SERVER/api/v1/agents/install/linux) --token <TOKEN> [--service]"
  exit 1
fi

echo "Baixando NodeAccess Agent..."
curl -fsSL "$SERVER/api/v1/agents/download/linux" -o /tmp/nodeaccess-agent
chmod +x /tmp/nodeaccess-agent
sudo mv /tmp/nodeaccess-agent /usr/local/bin/nodeaccess-agent
echo "Binario instalado em /usr/local/bin/nodeaccess-agent"

if [[ "$INSTALL_SERVICE" == true ]]; then
  echo "Configurando servico systemd..."
  sudo tee /etc/systemd/system/nodeaccess-agent.service > /dev/null << UNIT
[Unit]
Description=NodeAccess Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/nodeaccess-agent --server $SERVER --token $TOKEN
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now nodeaccess-agent
  echo "Servico nodeaccess-agent ativado e iniciado"
else
  echo ""
  echo "Para iniciar o agente:"
  echo "  nodeaccess-agent --server $SERVER --token $TOKEN"
  echo ""
  echo "Para instalar como servico systemd, execute com --service:"
  echo "  bash <(curl -fsSL $SERVER/api/v1/agents/install/linux) --token $TOKEN --service"
fi
`
      return reply
        .header('Content-Type', 'text/x-shellscript; charset=utf-8')
        .send(script)
    },
  })

  app.get<{ Querystring: InstallQuery }>('/install/macos', {
    schema: { tags: tag, summary: 'Script de instalação para macOS (bash)', querystring: installQuerySchema },
    handler: async (req, reply) => {
      const s = resolveInstallServerUrl(req)
      const script = `#!/usr/bin/env bash
set -euo pipefail

SERVER="${s}"
TOKEN=""
INSTALL_SERVICE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)   TOKEN="$2";          shift 2 ;;
    --service) INSTALL_SERVICE=true; shift   ;;
    *)         shift ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "Uso: bash <(curl -fsSL $SERVER/api/v1/agents/install/macos) --token <TOKEN> [--service]"
  exit 1
fi

echo "Baixando NodeAccess Agent..."
curl -fsSL "$SERVER/api/v1/agents/download/macos" -o /tmp/nodeaccess-agent
chmod +x /tmp/nodeaccess-agent
sudo mv /tmp/nodeaccess-agent /usr/local/bin/nodeaccess-agent
echo "Binario instalado em /usr/local/bin/nodeaccess-agent"

if [[ "$INSTALL_SERVICE" == true ]]; then
  echo "Configurando servico launchd..."
  PLIST_PATH="/Library/LaunchDaemons/com.nodeaccess.agent.plist"
  sudo tee "$PLIST_PATH" > /dev/null << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nodeaccess.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/nodeaccess-agent</string>
    <string>--server</string><string>$SERVER</string>
    <string>--token</string><string>$TOKEN</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/nodeaccess-agent.log</string>
  <key>StandardErrorPath</key><string>/var/log/nodeaccess-agent.log</string>
</dict>
</plist>
PLIST
  sudo launchctl load -w "$PLIST_PATH"
  echo "Servico com.nodeaccess.agent ativado e iniciado"
else
  echo ""
  echo "Para iniciar o agente:"
  echo "  nodeaccess-agent --server $SERVER --token $TOKEN"
  echo ""
  echo "Para instalar como servico launchd, execute com --service:"
  echo "  bash <(curl -fsSL $SERVER/api/v1/agents/install/macos) --token $TOKEN --service"
fi
`
      return reply
        .header('Content-Type', 'text/x-shellscript; charset=utf-8')
        .send(script)
    },
  })

  app.get<{ Querystring: InstallQuery }>('/install/windows', {
    schema: { tags: tag, summary: 'Script de instalação para Windows (PowerShell)', querystring: installQuerySchema },
    handler: async (req, reply) => {
      const s = resolveInstallServerUrl(req)
      const script = `param(
  [Parameter(Mandatory=$true)][string]$Token,
  [switch]$Service
)

$Server  = "${s}"
$InstallDir = "C:\\Program Files\\NodeAccess"
$Exe        = "$InstallDir\\nodeaccess-agent.exe"
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin) {
  Write-Host "Este script precisa ser executado no PowerShell como Administrador." -ForegroundColor Yellow
  Write-Host "Clique com o botao direito no PowerShell e escolha 'Executar como administrador'."
  exit 1
}

Write-Host "Baixando NodeAccess Agent..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Invoke-WebRequest -Uri "$Server/api/v1/agents/download/windows" -OutFile $Exe
Write-Host "Binario instalado em $Exe"

if ($Service) {
  Write-Host "Configurando tarefa agendada..."
  $action   = New-ScheduledTaskAction -Execute $Exe -Argument "--server $Server --token $Token"
  $trigger  = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet \`
    -ExecutionTimeLimit ([TimeSpan]::Zero) \`
    -RestartCount 999 \`
    -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName "NodeAccessAgent" \`
    -Action $action -Trigger $trigger -Settings $settings \`
    -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName "NodeAccessAgent"
  Write-Host "Tarefa agendada 'NodeAccessAgent' criada e iniciada"
} else {
  Write-Host ""
  Write-Host "Para iniciar o agente:"
  Write-Host "  & \`"$Exe\`" --server $Server --token $Token"
  Write-Host ""
  Write-Host "Para instalar como tarefa agendada, execute com -Service:"
  Write-Host "  & ([scriptblock]::Create((irm $Server/api/v1/agents/install/windows))) -Token $Token -Service"
}
`
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .send(script)
    },
  })

  app.get('/downloads', {
    schema: {
      tags: tag,
      summary: 'Listar binários do agente publicados no servidor',
    },
    handler: async (_req, reply) => {
      const downloads = Object.entries(BINARY_MAP).map(([platform, entry]) => {
        const filePath = resolveAgentBinary(entry.file)
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

      const filePath = resolveAgentBinary(entry.file)
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
