import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { AgentController } from './agent.controller.js'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../../config/env.js'

import { readWindowsAgentUpdate } from './agent-update.js'

const tag = ['Agents']

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Binários ficam em apps/agent/dist em dev e em /app/agent/dist na imagem prod.
const AGENT_DIST_CANDIDATES = [
  resolve(__dirname, '../../../../agent/dist'),
  resolve(process.cwd(), 'agent/dist'),
  resolve(process.cwd(), 'apps/agent/dist'),
] as const

const BINARY_MAP: Record<string, { file: string; mime: string; download: string; kind: 'binary' | 'installer'; recommended?: boolean }> = {
  windows_msi: { file: 'nodeaccess-agent-windows-x64.msi', mime: 'application/x-msi', download: 'nodeaccess-agent-windows-x64.msi', kind: 'installer', recommended: true },
  windows: { file: 'nodeaccess-agent-win.exe', mime: 'application/octet-stream', download: 'nodeaccess-agent.exe', kind: 'binary' },
  linux:   { file: 'nodeaccess-agent-linux', mime: 'application/octet-stream', download: 'nodeaccess-agent-linux', kind: 'binary' },
  macos:   { file: 'nodeaccess-agent-macos', mime: 'application/octet-stream', download: 'nodeaccess-agent-macos', kind: 'binary' },
}

function resolveAgentBinary(fileName: string): string {
  for (const dir of AGENT_DIST_CANDIDATES) {
    const filePath = resolve(dir, fileName)
    if (existsSync(filePath)) return filePath
  }
  return resolve(AGENT_DIST_CANDIDATES[0]!, fileName)
}

function resolveAgentDownloadVersion(platform: string): string {
  if (platform === 'windows' || platform === 'windows_msi') {
    try {
      const rawManifest = readFileSync(resolveAgentBinary('nodeaccess-agent-windows-x64.json'), 'utf8').replace(/^\uFEFF/, '')
      const manifest = JSON.parse(rawManifest) as { version?: unknown }
      if (typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version)) return manifest.version
    } catch { /* artefato ainda nao publicado; usa a versao da aplicacao */ }
  }
  return process.env.APP_VERSION || process.env.npm_package_version || '0.1.0'
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
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/' && !/[\s"'`$<>\\]/.test(value)
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

  if (host && isHttpUrl(`${forwardedProto || 'http'}://${host}`)) return cleanBaseUrl(`${forwardedProto || 'http'}://${host}`)

  return cleanBaseUrl(env.APP_URL)
}

const installQuerySchema = {
  type: 'object',
  properties: {
    server: { type: 'string' },
  },
}

const windowsAgentPreflight = `
Write-Host "Validando compatibilidade do agente..."
if (-not (Test-Path $Exe) -or (Get-Item $Exe).Length -le 0) {
  Write-Host "O executavel do agente nao foi encontrado ou esta vazio." -ForegroundColor Red
  Write-Host "Baixe novamente pelo painel e tente outra vez."
  exit 1
}
$AgentVersion = (& $Exe --version 2>&1 | Out-String).Trim()
$AgentHelp = (& $Exe 2>&1 | Out-String)
if ($AgentHelp -notmatch [regex]::Escape('--token-file')) {
  Write-Host "O binario publicado e incompativel com este instalador." -ForegroundColor Red
  Write-Host "Versao detectada: $AgentVersion"
  Write-Host "O agente nao foi iniciado. Atualize o pacote no servidor NodeAccess e execute o comando novamente."
  exit 1
}
Write-Host "Compatibilidade confirmada: $AgentVersion" -ForegroundColor Green
`

const windowsAgentLaunch = `
if ($Service) {
  Write-Host "Configurando inicializacao automatica..."
  $AgentArgs = '--server "{0}" --token-file "{1}"' -f $Server, $TokenFile
  $action = New-ScheduledTaskAction -Execute $Exe -Argument $AgentArgs
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName "NodeAccessAgent" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName "NodeAccessAgent"
  Start-Sleep -Seconds 3
  $Task = Get-ScheduledTask -TaskName "NodeAccessAgent"
  if ($Task.State -ne 'Running') {
    $TaskInfo = Get-ScheduledTaskInfo -TaskName "NodeAccessAgent"
    Write-Host "O servico foi configurado, mas o agente nao permaneceu em execucao." -ForegroundColor Red
    Write-Host "Resultado da ultima execucao: $($TaskInfo.LastTaskResult)"
    Write-Host "Confirme a versao do binario, a URL do servidor e as regras de VPN/proxy/firewall."
    exit 1
  }
  Write-Host "Processo do agente em execucao como tarefa agendada." -ForegroundColor Green
  Write-Host "Volte ao painel NodeAccess e aguarde o status Online. A tarefa em execucao ainda nao confirma a conexao." -ForegroundColor Cyan
} else {
  Write-Host "Iniciando o processo do agente para teste..." -ForegroundColor Cyan
  Write-Host "Mantenha esta janela aberta. A conexao sera confirmada no painel NodeAccess."
  & $Exe --server $Server --token-file $TokenFile
  $AgentExitCode = $LASTEXITCODE
  if ($AgentExitCode -ne 0) {
    Write-Host "O agente encerrou antes de permanecer conectado (codigo $AgentExitCode)." -ForegroundColor Red
    Write-Host "Revise a mensagem acima e verifique URL, VPN, proxy, firewall e token."
    exit $AgentExitCode
  }
  Write-Host "O processo do agente foi encerrado e agora aparecera Offline no painel." -ForegroundColor Yellow
}
`

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

  const agentIdParams = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
  app.get('/:id/impact', { preHandler: [requireAuth], schema: { tags: tag, summary: 'Impacto antes de alterar um agente', security: [{ bearerAuth: [] }], params: agentIdParams }, handler: ctrl.impact.bind(ctrl) })
  app.get('/:id/history', { preHandler: [requireAuth], schema: { tags: tag, summary: 'Histórico operacional do agente', security: [{ bearerAuth: [] }], params: agentIdParams }, handler: ctrl.history.bind(ctrl) })
  app.post('/:id/maintenance', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Iniciar drenagem ou reabrir agente', security: [{ bearerAuth: [] }], params: agentIdParams, body: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } } },
    handler: ctrl.maintenance.bind(ctrl),
  })
  app.post('/:id/rotate-token', { preHandler: [requireAuth], schema: { tags: tag, summary: 'Rotacionar token do agente', security: [{ bearerAuth: [] }], params: agentIdParams }, handler: ctrl.rotateToken.bind(ctrl) })
  app.put('/:id/pool', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Configurar pool e prioridade', security: [{ bearerAuth: [] }], params: agentIdParams, body: { type: 'object', additionalProperties: false, properties: { poolName: { type: ['string', 'null'], maxLength: 120 }, priority: { type: 'integer', minimum: 1, maximum: 1000 } } } },
    handler: ctrl.configurePool.bind(ctrl),
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
TRUSTED_KEY=""
POLICY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)   TOKEN="$2";          shift 2 ;;
    --service) INSTALL_SERVICE=true; shift   ;;
    --trusted-key) TRUSTED_KEY="$2"; shift 2 ;;
    --policy) POLICY="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "Uso: bash <(curl -fsSL $SERVER/api/v1/agents/install/linux) --token <TOKEN> [--service]"
  exit 1
fi

echo "Baixando NodeAccess Agent..."
[[ "$SERVER" == https://* ]] || { echo "Instalacao exige HTTPS"; exit 1; }
[[ -f "$TRUSTED_KEY" ]] || { echo "Informe --trusted-key <chave-publica-PEM-confiavel>, obtida por um canal independente."; exit 1; }
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
curl --proto '=https' --tlsv1.2 -fsS "$SERVER/api/v1/agents/download/linux" -o "$WORKDIR/agent"
curl --proto '=https' --tlsv1.2 -fsS "$SERVER/api/v1/agents/signature/linux" -o "$WORKDIR/agent.sig"
openssl dgst -sha256 -verify "$TRUSTED_KEY" -signature "$WORKDIR/agent.sig" "$WORKDIR/agent"
chmod 700 "$WORKDIR/agent"
if [[ -n "$POLICY" ]]; then "$WORKDIR/agent" --check-policy "$POLICY"; fi
sudo install -m 755 "$WORKDIR/agent" /usr/local/bin/nodeaccess-agent
echo "Binario instalado em /usr/local/bin/nodeaccess-agent"

if [[ "$INSTALL_SERVICE" == true ]]; then
  echo "Configurando servico systemd..."
  getent group nodeaccess-agent >/dev/null || sudo groupadd --system nodeaccess-agent
  id nodeaccess-agent >/dev/null 2>&1 || sudo useradd --system --gid nodeaccess-agent --no-create-home --shell /usr/sbin/nologin nodeaccess-agent
  sudo install -d -o root -g nodeaccess-agent -m 750 /etc/nodeaccess-agent
  POLICY_ARG=""
  if [[ -n "$POLICY" ]]; then
    sudo install -o root -g nodeaccess-agent -m 640 "$POLICY" /etc/nodeaccess-agent/policy.json
    POLICY_ARG="--policy /etc/nodeaccess-agent/policy.json"
  elif sudo test -f /etc/nodeaccess-agent/policy.json; then
    POLICY_ARG="--policy /etc/nodeaccess-agent/policy.json"
  fi
  printf '%s' "$TOKEN" | sudo tee /etc/nodeaccess-agent/token > /dev/null
  sudo chown root:nodeaccess-agent /etc/nodeaccess-agent/token
  sudo chmod 640 /etc/nodeaccess-agent/token
  sudo tee /etc/systemd/system/nodeaccess-agent.service > /dev/null << UNIT
[Unit]
Description=NodeAccess Agent
After=network.target

[Service]
User=nodeaccess-agent
Group=nodeaccess-agent
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
RestrictSUIDSGID=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ExecStart=/usr/local/bin/nodeaccess-agent --server $SERVER --token-file /etc/nodeaccess-agent/token $POLICY_ARG
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
  echo "  nodeaccess-agent --server $SERVER --token-file <arquivo-protegido>"
  echo ""
  echo "Para instalar como servico systemd, execute com --service:"
  echo "  bash <(curl -fsSL $SERVER/api/v1/agents/install/linux) --token <TOKEN> --service --trusted-key <chave-publica.pem>"
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
TRUSTED_KEY=""
POLICY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)   TOKEN="$2";          shift 2 ;;
    --service) INSTALL_SERVICE=true; shift   ;;
    --trusted-key) TRUSTED_KEY="$2"; shift 2 ;;
    --policy) POLICY="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "Uso: bash <(curl -fsSL $SERVER/api/v1/agents/install/macos) --token <TOKEN> [--service]"
  exit 1
fi

echo "Baixando NodeAccess Agent..."
[[ "$SERVER" == https://* ]] || { echo "Instalacao exige HTTPS"; exit 1; }
[[ -f "$TRUSTED_KEY" ]] || { echo "Informe --trusted-key <chave-publica-PEM-confiavel>, obtida por um canal independente."; exit 1; }
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
curl --proto '=https' --tlsv1.2 -fsS "$SERVER/api/v1/agents/download/macos" -o "$WORKDIR/agent"
curl --proto '=https' --tlsv1.2 -fsS "$SERVER/api/v1/agents/signature/macos" -o "$WORKDIR/agent.sig"
openssl dgst -sha256 -verify "$TRUSTED_KEY" -signature "$WORKDIR/agent.sig" "$WORKDIR/agent"
chmod 700 "$WORKDIR/agent"
if [[ -n "$POLICY" ]]; then "$WORKDIR/agent" --check-policy "$POLICY"; fi
sudo install -m 755 "$WORKDIR/agent" /usr/local/bin/nodeaccess-agent
echo "Binario instalado em /usr/local/bin/nodeaccess-agent"

if [[ "$INSTALL_SERVICE" == true ]]; then
  echo "Configurando servico launchd..."
  PLIST_PATH="/Library/LaunchDaemons/com.nodeaccess.agent.plist"
  TOKEN_DIR="/Library/Application Support/NodeAccess"
  sudo mkdir -p "$TOKEN_DIR"
  printf '%s' "$TOKEN" | sudo tee "$TOKEN_DIR/token" > /dev/null
  sudo chmod 600 "$TOKEN_DIR/token"
  POLICY_XML=""
  if [[ -n "$POLICY" ]]; then sudo install -m 600 "$POLICY" "$TOKEN_DIR/policy.json"; fi
  if sudo test -f "$TOKEN_DIR/policy.json"; then POLICY_XML="<string>--policy</string><string>/Library/Application Support/NodeAccess/policy.json</string>"; fi
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
    <string>--token-file</string><string>/Library/Application Support/NodeAccess/token</string>
    $POLICY_XML
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
  echo "  nodeaccess-agent --server $SERVER --token-file <arquivo-protegido>"
  echo ""
  echo "Para instalar como servico launchd, execute com --service:"
  echo "  bash <(curl -fsSL $SERVER/api/v1/agents/install/macos) --token <TOKEN> --service --trusted-key <chave-publica.pem>"
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
  [string]$TrustedPublisher = "",
  [switch]$Service
)

$Server  = "${s}"
$InstallDir = "C:\\Program Files\\NodeAccess"
$Exe        = "$InstallDir\\nodeaccess-agent.exe"
$TokenFile  = "$InstallDir\\agent.token"
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin) {
  Write-Host "Este script precisa ser executado no PowerShell como Administrador." -ForegroundColor Yellow
  Write-Host "Clique com o botao direito no PowerShell e escolha 'Executar como administrador'."
  exit 1
}

if (([Uri]$Server).Scheme -ne 'https') { throw 'Instalacao exige HTTPS.' }
if ($TrustedPublisher -notmatch '^[a-fA-F0-9]{40}$') { throw 'Informe -TrustedPublisher com o thumbprint oficial do certificado, obtido por canal independente.' }
Write-Host "Baixando NodeAccess Agent..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
try {
  $DownloadedExe = Join-Path $InstallDir ([guid]::NewGuid().ToString() + '.exe')
  Invoke-WebRequest -Uri "$Server/api/v1/agents/download/windows" -OutFile $DownloadedExe -ErrorAction Stop
  $Signature = Get-AuthenticodeSignature $DownloadedExe
  if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Thumbprint -ine $TrustedPublisher) { Remove-Item $DownloadedExe -Force; throw 'Assinatura ou editor nao confiavel.' }
  Move-Item $DownloadedExe $Exe -Force
} catch {
  Write-Host "Falha ao baixar o agente: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Verifique a URL do NodeAccess, o certificado HTTPS e a conectividade desta maquina."
  exit 1
}
Set-Content -Path $TokenFile -Value $Token -NoNewline
# SIDs bem conhecidos evitam falha em Windows traduzido (ex.: "Administradores").
icacls $TokenFile /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null
Write-Host "Binario instalado em $Exe"

${windowsAgentPreflight}
${windowsAgentLaunch}
`
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .send(script)
    },
  })

  app.get<{ Querystring: InstallQuery }>('/register/windows', {
    schema: { tags: tag, summary: 'Registrar uma instalação MSI do agente Windows', querystring: installQuerySchema },
    handler: async (req, reply) => {
      const s = resolveInstallServerUrl(req)
      const script = `param(
  [Parameter(Mandatory=$true)][string]$Token,
  [switch]$Service
)

$Server     = "${s}"
$InstallDir = "C:\\Program Files\\NodeAccess"
$Exe        = "$InstallDir\\nodeaccess-agent.exe"
$TokenFile  = "$InstallDir\\agent.token"
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin) {
  Write-Host "Execute o PowerShell como Administrador para registrar o NodeAccess Agent." -ForegroundColor Yellow
  exit 1
}
if (-not (Test-Path $Exe)) {
  Write-Host "NodeAccess Agent nao encontrado em $Exe. Instale o pacote MSI antes de registrar." -ForegroundColor Red
  exit 1
}

Set-Content -Path $TokenFile -Value $Token -NoNewline
icacls $TokenFile /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null

${windowsAgentPreflight}
${windowsAgentLaunch}
`
      return reply.header('Content-Type', 'text/plain; charset=utf-8').send(script)
    },
  })

  app.get('/updates/windows', {
    schema: { tags: tag, summary: 'Consultar a versao publicada do instalador Windows' },
    handler: async (_req, reply) => {
      reply.header('Cache-Control', 'no-store')
      try {
        return reply.send(readWindowsAgentUpdate(dirname(resolveAgentBinary('nodeaccess-agent-windows-x64.json'))))
      } catch {
        return reply.status(503).send({ error: 'Atualizacao do agente indisponivel neste servidor.' })
      }
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
          kind: entry.kind,
          recommended: entry.recommended ?? false,
          version: resolveAgentDownloadVersion(platform),
        }
      })

      return reply.send(downloads)
    },
  })

  // ── Download binário do agente (público — sem auth) ─────────────────────────
  app.get<{ Params: { platform: string } }>('/signature/:platform', async (req, reply) => {
    const entry = ['linux', 'macos'].includes(req.params.platform) ? BINARY_MAP[req.params.platform] : undefined
    if (!entry) return reply.code(404).send({ message: 'Signature unavailable' })
    const file = resolveAgentBinary(entry.file + '.sig')
    if (!existsSync(file)) return reply.code(404).send({ message: 'Signature unavailable' })
    return reply.header('Content-Type', 'application/octet-stream').send(createReadStream(file))
  })

  app.get('/download/:platform', {
    schema: {
      tags: tag,
      summary: 'Baixar binário do agente para o sistema operacional',
      params: {
        type: 'object',
        properties: { platform: { type: 'string', enum: ['windows_msi', 'windows', 'linux', 'macos'] } },
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
