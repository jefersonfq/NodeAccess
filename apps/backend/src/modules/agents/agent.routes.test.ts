import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import * as updates from './agent-update.js'
import { agentRoutes } from './agent.routes.js'
import type { AgentController } from './agent.controller.js'

function controllerStub(): AgentController {
  const handler = async () => ({})
  return new Proxy({}, { get: () => handler }) as AgentController
}

describe('agent installation scripts', () => {
  it.each([
    ['linux', '/etc/nodeaccess-agent/token'],
    ['macos', '/Library/Application Support/NodeAccess/token'],
    ['windows', 'agent.token'],
  ])('stores service token outside process arguments on %s', async (platform, tokenPath) => {
    const app = Fastify()
    await app.register(async instance => agentRoutes(instance, controllerStub()))
    try {
      const response = await app.inject({ method: 'GET', url: `/install/${platform}?server=https%3A%2F%2Fnodeaccess.test` })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('--token-file')
      expect(response.body).toContain(tokenPath)
      expect(response.body).not.toMatch(/ExecStart=.*--token\s/)
      expect(response.body).not.toMatch(/New-ScheduledTaskAction[^\n]+--token\s/)
    } finally { await app.close() }
  })

  it('downloads and starts the Windows binary without relying on the current directory or localized account names', async () => {
    const app = Fastify()
    await app.register(async instance => agentRoutes(instance, controllerStub()))
    try {
      const response = await app.inject({ method: 'GET', url: '/install/windows?server=https%3A%2F%2Fnodeaccess.test' })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('Invoke-WebRequest -Uri "$Server/api/v1/agents/download/windows" -OutFile $DownloadedExe')
      expect(response.body).toContain('-ErrorAction Stop')
      expect(response.body).toContain('Falha ao baixar o agente')
      expect(response.body).not.toContain('Copy-Item ".\\nodeaccess-agent.exe"')
      expect(response.body).toContain('*S-1-5-32-544:F')
      expect(response.body).not.toContain('"Administrators:F"')
      expect(response.body).toContain('& $Exe --server $Server --token-file $TokenFile')
    } finally { await app.close() }
  })

  it.each(['/install/windows', '/register/windows'])('validates the Windows artifact and reports process state without claiming connection on %s', async endpoint => {
    const app = Fastify()
    await app.register(async instance => agentRoutes(instance, controllerStub()))
    try {
      const response = await app.inject({ method: 'GET', url: `${endpoint}?server=https%3A%2F%2Fnodeaccess.test` })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('Validando compatibilidade do agente')
      expect(response.body).toContain("$AgentHelp -notmatch [regex]::Escape('--token-file')")
      expect(response.body).toContain('O binario publicado e incompativel com este instalador')
      expect(response.body).toContain('Start-Sleep -Seconds 3')
      expect(response.body).toContain("$Task.State -ne 'Running'")
      expect(response.body).toContain('LastTaskResult')
      expect(response.body).toContain('A tarefa em execucao ainda nao confirma a conexao')
      expect(response.body).toContain('Mantenha esta janela aberta. A conexao sera confirmada no painel NodeAccess.')
      expect(response.body).toContain('O agente encerrou antes de permanecer conectado')
      expect(response.body).not.toContain('Iniciando NodeAccess Agent. Mantenha esta janela aberta...')
    } finally { await app.close() }
  })

  it.each([false, true])('registers an MSI installation without downloading or exposing the token in task arguments (service=%s)', async service => {
    const app = Fastify()
    await app.register(async instance => agentRoutes(instance, controllerStub()))
    try {
      const response = await app.inject({ method: 'GET', url: '/register/windows?server=https%3A%2F%2Fnodeaccess.test' })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('Test-Path $Exe')
      expect(response.body).not.toContain('Invoke-WebRequest')
      expect(response.body).toContain('*S-1-5-32-544:F')
      expect(response.body).toContain('--token-file')
      expect(response.body).not.toMatch(/New-ScheduledTaskAction[^\n]+--token\s/)
      expect(response.body).toContain(service ? 'Register-ScheduledTask' : '& $Exe --server $Server --token-file $TokenFile')
    } finally { await app.close() }
  })

  it('publishes the MSI as the recommended Windows artifact with version metadata', async () => {
    const app = Fastify()
    await app.register(async instance => agentRoutes(instance, controllerStub()))
    try {
      const response = await app.inject({ method: 'GET', url: '/downloads' })
      expect(response.statusCode).toBe(200)
      const downloads = response.json() as Array<Record<string, unknown>>
      expect(downloads.find(item => item.platform === 'windows_msi')).toMatchObject({
        fileName: 'nodeaccess-agent-windows-x64.msi',
        kind: 'installer',
        recommended: true,
        downloadUrl: '/api/v1/agents/download/windows_msi',
      })
      expect(downloads.find(item => item.platform === 'windows_msi')?.version).toEqual(expect.any(String))
      expect(downloads.find(item => item.platform === 'windows_msi')?.version)
        .toBe(downloads.find(item => item.platform === 'windows')?.version)
    } finally { await app.close() }
  })
})


describe('public agent update lookup', () => {
  it.each([false, true])('returns bounded release metadata or an actionable unavailable response (failure=%s)', async failure => {
    const metadata = { schemaVersion: 1, version: '1.4.0', platform: 'windows', architecture: 'x64', downloadPath: '/api/v1/agents/download/windows_msi', size: 100, sha256: 'a'.repeat(64) }
    const reader = vi.spyOn(updates, 'readWindowsAgentUpdate').mockImplementation(() => { if (failure) throw new Error('private path'); return metadata })
    const app = Fastify()
    try {
      await app.register(async instance => agentRoutes(instance, controllerStub()))
      const response = await app.inject({ method: 'GET', url: '/updates/windows' })
      expect(response.statusCode).toBe(failure ? 503 : 200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toEqual(failure ? { error: 'Atualizacao do agente indisponivel neste servidor.' } : metadata)
      expect(response.body).not.toContain('private path')
    } finally { reader.mockRestore(); await app.close() }
  })
})

it('generates a Linux service with independent signature verification and least privilege', async () => {
  const app = Fastify()
  await app.register(async instance => agentRoutes(instance, controllerStub()))
  try {
    const result = await app.inject('/install/linux?server=https%3A%2F%2Fexample.test')
    const script = result.body
    expect(script).toContain('openssl dgst -sha256 -verify "$TRUSTED_KEY"')
    expect(script.indexOf('openssl dgst')).toBeLessThan(script.indexOf('sudo install -m 755'))
    expect(script).toContain('User=nodeaccess-agent')
    expect(script).toContain('NoNewPrivileges=yes')
    expect(script).toContain('ProtectSystem=strict')
    expect(script).toContain('--policy /etc/nodeaccess-agent/policy.json')
    expect(script).not.toContain('--token $TOKEN')
    expect(script).not.toContain('-o /tmp/nodeaccess-agent')
    const { spawnSync } = await import('node:child_process')
    expect(spawnSync('bash', ['-n'], { input: script }).status).toBe(0)
  } finally { await app.close() }
})
