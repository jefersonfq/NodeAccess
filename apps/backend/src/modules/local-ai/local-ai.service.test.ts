import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.FEATURE_LOCAL_AI = 'true'
  process.env.NODE_ENV ||= 'test'
})

import { classifyActionCommand } from '../ai-ssh-actions/ai-ssh-action-command-policy.js'
import { LocalAiService } from './local-ai.service.js'

function terminalRequestBody(): { messages: Array<{ content: string }>; format: unknown } {
  const body = vi.mocked(fetch).mock.calls[0]?.[1]?.body
  if (typeof body !== 'string') throw new Error('Expected JSON provider request')
  return JSON.parse(body) as { messages: Array<{ content: string }>; format: unknown }
}

const user = { sub: '11', tenantId: 7, role: 'admin' as const, email: 'admin@example.test', stage: 'authenticated' as const }

function service(config: Record<string, unknown>) {
  const operationalConfig = { healthStatus: 'healthy', lastCheckedAt: new Date().toISOString(), ...config }
  return new LocalAiService(
    { findByProvider: vi.fn().mockResolvedValue({ enabled: true, config: JSON.stringify(operationalConfig) }) } as never,
    { isFeatureEnabled: vi.fn().mockResolvedValue(true) } as never,
    {} as never,
    { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never,
    { evaluateMany: vi.fn().mockResolvedValue([]) } as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  )
}

describe('LocalAiService provider routing status', () => {
  const both = {
    localProvider: 'ollama', localBaseUrl: 'http://ollama:11434', localModel: 'qwen',
    networkProvider: 'openai_compatible', networkBaseUrl: 'https://ai.example/v1', networkModel: 'gpt',
    networkApiKeyEncrypted: 'encrypted', networkApiKeyIv: 'iv',
  }

  it('makes provider priority and runtime failover explicit', async () => {
    const status = await service({ ...both, routingPolicy: 'prefer_local' }).getStatus(user)
    expect(status.effectiveProvider).toBe('ollama')
    expect(status.runtimeFailoverEnabled).toBe(true)
    expect(status.routingExplanation).toContain('provider alternativo')
    expect(status.providerStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'ollama', configured: true, selected: true }),
      expect.objectContaining({ key: 'openai_compatible', configured: true, selected: false }),
    ]))
  })

  it('does not enable failover for an exclusive routing policy', async () => {
    const status = await service({ ...both, routingPolicy: 'local_only' }).getStatus(user)
    expect(status.runtimeFailoverEnabled).toBe(false)
    expect(status.effectiveProvider).toBe('ollama')
  })

  it('selects network deterministically when network_only is configured', async () => {
    const status = await service({ ...both, routingPolicy: 'network_only' }).getStatus(user)
    expect(status.effectiveProvider).toBe('openai_compatible')
    expect(status.providerStates?.find((item) => item.key === 'openai_compatible')?.selected).toBe(true)
  })

  it('reports an unmet policy instead of silently selecting another provider', async () => {
    const status = await service({
      localProvider: 'ollama', localBaseUrl: 'http://ollama:11434', localModel: 'qwen',
      routingPolicy: 'network_only',
    }).getStatus(user)
    expect(status.available).toBe(false)
    expect(status.effectiveProvider).toBeNull()
    expect(status.routingExplanation).toContain('Nenhum provider')
  })

  it('does not expose a configured provider whose healthcheck expired', async () => {
    const status = await service({
      ...both,
      routingPolicy: 'local_only',
      lastCheckedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }).getStatus(user)
    expect(status.available).toBe(false)
    expect(status.message).toContain('expirou')
  })
})

describe('LocalAiService diagnostic plan', () => {
  afterEach(() => vi.unstubAllGlobals())

  function diagnosticService(risks: Array<'safe' | 'approval_required' | 'blocked'>, realPolicy = false, realProvider?: { baseUrl: string; model: string }, platform = 'LINUX') {
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const entitlements = { requireFeature: vi.fn().mockResolvedValue(undefined) }
    let policyIndex = 0
    const evaluate = vi.fn<(input: { command: string }) => Promise<{ command: string; risk: string }>>().mockImplementation(({ command }) => Promise.resolve({ command, risk: realPolicy ? classifyActionCommand(command) : risks[policyIndex++] ?? 'safe' }))
    const instance = new LocalAiService(
      { findByProvider: vi.fn().mockResolvedValue({
        enabled: true,
        config: JSON.stringify({
          localProvider: 'ollama',
          localBaseUrl: realProvider?.baseUrl ?? 'http://ollama:11434',
          localModel: realProvider?.model ?? 'qwen',
          routingPolicy: 'local_only',
          healthStatus: 'healthy',
          lastCheckedAt: new Date().toISOString(),
        }),
      }) } as never,
      entitlements as never,
      { getHostSummary: vi.fn().mockResolvedValue({
        id: 42,
        name: 'srv-app',
        ip: '10.0.0.42',
        port: 22,
        sshUser: 'ops',
        connectionMode: 'direct',
        operatingSystem: platform,
      }) } as never,
      logs as never,
      {
        evaluate,
        evaluateMany: vi.fn().mockImplementation(({ commands }: { commands: string[] }) => Promise.resolve(
          commands.map((command, index) => ({ command, risk: risks[index] ?? 'safe' })),
        )),
      } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
    )
    return { instance, logs, entitlements, evaluate }
  }

  it('returns a non-executable preview when policy blocks a generated command', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({
        summary: 'Diagnóstico de carga e serviço',
        steps: [
          { label: 'Ver carga', command: 'uptime', timeoutSeconds: 30 },
          { label: 'Reiniciar serviço', command: 'systemctl restart nginx', timeoutSeconds: 60 },
        ],
      }) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { instance, logs } = diagnosticService(['safe', 'blocked'])

    const plan = await instance.generateDiagnosticPlan(user, { hostId: 42, objective: 'Verifique carga e o serviço nginx' })

    expect(plan.executable).toBe(false)
    expect(plan.steps.map((step) => step.risk)).toEqual(['safe', 'blocked'])
    expect(plan.warnings.join(' ')).toContain('bloqueado')
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOCAL_AI_DIAGNOSTIC_PLAN_GENERATED',
      targetId: 42,
    }))
  })

  it('requires approval mode when any command is classified accordingly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: '```json\n{"summary":"Coleta segura","steps":[{"label":"Logs","command":"journalctl -n 50","timeoutSeconds":45}]}\n```' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { instance } = diagnosticService(['approval_required'])

    const plan = await instance.generateDiagnosticPlan(user, { hostId: 42, objective: 'Colete os logs recentes do sistema' })

    expect(plan.executable).toBe(true)
    expect(plan.recommendedMode).toBe('approval_required')
  })

  it('allows inserting only a safe, single-line command without executing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({ title: 'Uso de disco', explanation: 'Consulta somente leitura.', content: 'df -h' }) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { instance, logs, entitlements } = diagnosticService(['safe'])

    const result = await instance.terminalAssist(user, {
      hostId: 42,
      instruction: 'Verifique o espaço livre',
      intent: 'command',
      terminalContext: { hostId: 42, recentOutput: '$ uptime' },
    })

    expect(result).toMatchObject({ kind: 'command', content: 'df -h', risk: 'safe', canInsert: true })
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOCAL_AI_TERMINAL_ASSIST_GENERATED' }))
    expect(JSON.stringify(logs.logAdminEvent.mock.calls)).not.toContain('df -h')
    expect(entitlements.requireFeature).toHaveBeenCalledWith(7, 'terminalAi', expect.any(String))
  })

  it('supports everyday port lookup without claiming terminal output was supplied', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({ title: 'Portas', explanation: 'Lista portas em escuta.', content: 'ss -lntup' }) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { instance } = diagnosticService(['safe'])
    const result = await instance.terminalAssist(user, { hostId: 42, instruction: 'Liste portas', intent: 'command' })
    expect(result).toMatchObject({ content: 'ss -lntup', canInsert: true, warnings: [] })
    const prompt=terminalRequestBody().messages[0]!.content
    expect(prompt).toContain('Sugira exatamente um comando de shell')
    expect(prompt).not.toContain('duas ou três opções no total')
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).toContain('Sem contexto adicional do terminal.')
  })


  it('normalizes presentation quotes before evaluating every distinct alternative', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({ title: 'Portas', explanation: 'Lista sockets.', content: '"ss -lntup"', alternatives: [
        {content: 'netstat -lnt', explanation: 'Lista TCP.'},
        {content: 'systemctl restart nginx', explanation: 'Mutação.'},
      ] }) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { instance, evaluate } = diagnosticService(['safe','safe','approval_required'])
    const result = await instance.terminalAssist(user, {hostId:42,intent:'command',instruction:'Liste portas',alternatives:true})
    expect(result.content).toBe('ss -lntup')
    expect(evaluate.mock.calls.map(call => call[0].command)).toEqual(['ss -lntup','netstat -lnt','systemctl restart nginx'])
    const prompt = terminalRequestBody().messages[0]!.content
    expect(prompt).toContain('duas ou três opções no total')
    expect(prompt).toContain('quando escolhê-la')
    expect(prompt).not.toContain('Sugira exatamente um comando de shell')
    expect(result.alternatives).toEqual([
      expect.objectContaining({content:'netstat -lnt',canInsert:true}),
      expect.objectContaining({canInsert:false,requiresApproval:true}),
    ])
  })

  it('deduplicates alternatives and rejects excessive provider options', async () => {
    const payload = {title:'Portas',explanation:'Lista sockets.',content:'ss -lntup',alternatives:[{content:'ss -lntup',explanation:'Duplicado.'}]}
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      message:{content:JSON.stringify(payload)},
    }), {status:200,headers:{'Content-Type':'application/json'}}))))
    const {instance,evaluate}=diagnosticService(['safe'])
    const result=await instance.terminalAssist(user,{hostId:42,intent:'command',instruction:'Liste portas',alternatives:true})
    expect(result.alternatives).toEqual([])
    expect(evaluate).toHaveBeenCalledTimes(1)
    payload.alternatives=Array.from({length:3}, () => ({content:'pwd',explanation:'Diretório.'}))
    await expect(instance.terminalAssist(user,{hostId:42,intent:'command',instruction:'Liste portas',alternatives:true})).rejects.toThrow()
  })

  it('accepts the reported Linux ports question with Markdown and real default policy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: {content: JSON.stringify({title:'Portas',explanation:'Lista portas em escuta.',content:'```bash\nss -lntup\n```',
        alternatives:[{content:'iptables -L',explanation:'Firewall.'},{content:'reboot',explanation:'Reinício.'}]})},
    }), {status:200,headers:{'Content-Type':'application/json'}})))
    const {instance,evaluate}=diagnosticService([],true)
    const result=await instance.terminalAssist(user,{hostId:42,intent:'command',instruction:'comando para ver portas no linux',alternatives:true})
    expect(result).toMatchObject({content:'ss -lntup',risk:'safe',canInsert:true})
    expect(terminalRequestBody().format).toMatchObject({type:'object'})
    expect(evaluate.mock.calls[0][0].command).toBe('ss -lntup')
    expect(result.alternatives).toEqual([
      expect.objectContaining({risk:'approval_required',canInsert:false}),
      expect.objectContaining({risk:'blocked',canInsert:false}),
    ])
  })

  it.skipIf(process.env.TEST_OLLAMA_PORTS !== '1').each([
    ['LINUX','comando para ver portas no linux', /\b(ss|netstat|lsof)\b/],
    ['LINUX','comando para ver espaço livre em disco no linux', /\bdf\b/],
    ['WINDOWS','comando PowerShell para listar conexões TCP no Windows', /Get-NetTCPConnection|netstat/i],
  ] as const)('real local provider: %s / %s', async (platform,instruction,expected) => {
    const {instance}=diagnosticService([],true,{baseUrl:'http://127.0.0.1:11434',model:'qwen2.5-coder:3b'},platform)
    const result=await instance.terminalAssist(user,{hostId:42,intent:'command',instruction,alternatives:true}, AbortSignal.timeout(20000))
    expect(result, JSON.stringify({content:result.content,alternatives:result.alternatives})).toMatchObject({kind:'command',risk:'safe',canInsert:true})
    expect(result.content).toMatch(expected)
    expect(result.content).not.toMatch(/[\r\n]/)
    if (platform === 'LINUX' && instruction.includes('portas')) {
      const accepted = [result, ...(result.alternatives ?? [])].filter(option => option.canInsert && option.risk === 'safe')
      expect(accepted.length, JSON.stringify({content:result.content,alternatives:result.alternatives})).toBeGreaterThanOrEqual(2)
      expect(new Set(accepted.map(option=>option.content)).size).toBe(accepted.length)
      expect(accepted.every(option=>option.explanation.trim().length>0)).toBe(true)
    }
  },25000)

  it('never allows direct insertion of scripts even when policy marks them safe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({ title: 'Coleta', explanation: 'Script para revisão.', content: '#!/bin/sh\nuptime\ndf -h' }) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { instance } = diagnosticService(['safe'])

    const result = await instance.terminalAssist(user, {
      hostId: 42, instruction: 'Crie uma coleta de saúde', intent: 'script', terminalContext: { hostId: 42 },
    })

    expect(result).toMatchObject({ kind: 'script', risk: 'safe', canInsert: false })
    expect(result.warnings.join(' ')).toContain('nunca inseridos automaticamente')
  })

  it('surfaces policy blocks without returning an insert capability', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({ title: 'Reinício', explanation: 'Ação mutável.', content: 'systemctl restart nginx' }) },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { instance } = diagnosticService(['blocked'])

    const result = await instance.terminalAssist(user, {
      hostId: 42, instruction: 'Reinicie o nginx', intent: 'command', terminalContext: { hostId: 42 },
    })

    expect(result).toMatchObject({ risk: 'blocked', canInsert: false })
  })
})
