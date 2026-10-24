import { describe, expect, it } from 'vitest'
import { buildMcpAgentSetup, validateMcpEndpoint } from './mcp-agent-setup'

describe('MCP client presets', () => {
  const endpoint = 'https://nodeaccess.example/api/v1/mcp/jsonrpc'
  it('generates Codex TOML and safely quoted registration with environment reference', () => {
    const setup = buildMcpAgentSetup(endpoint)
    expect(setup.config).toContain('[mcp_servers.nodeaccess]')
    expect(setup.config).toContain('bearer_token_env_var = "NODEACCESS_MCP_TOKEN"')
    expect(setup.register).toContain(`--url '${endpoint}'`)
  })
  it.each(['claude', 'gemini'] as const)('generates the documented %s JSON shape', (agent) => {
    const setup = buildMcpAgentSetup(endpoint, agent)
    const parsed = JSON.parse(setup.config) as { mcpServers: { nodeaccess: { headers: { Authorization: string }; httpUrl?: string; url?: string; type?: string } } }
    const entry = parsed.mcpServers.nodeaccess
    expect(entry.headers.Authorization).toBe('Bearer ${NODEACCESS_MCP_TOKEN}')
    if (agent === 'claude') expect(entry).toMatchObject({ type: 'http', url: endpoint })
    else { expect(entry.httpUrl).toBe(endpoint); expect(entry.url).toBeUndefined() }
    expect(setup.start).toContain(`  ${agent}\n`)
    expect(setup.register).toBeNull()
  })
  it('uses hidden entry and cleanup for both supported shells', () => {
    const bash = buildMcpAgentSetup(endpoint, 'codex', 'bash').start
    expect(bash).toMatch(/^\(\n/)
    expect(bash).toContain('read -rsp')
    expect(bash).toMatch(/\n\)$/)
    const powershell = buildMcpAgentSetup(endpoint, 'gemini', 'powershell').start
    expect(powershell).toContain('Read-Host "Token MCP" -AsSecureString')
    expect(powershell).toContain('ZeroFreeBSTR')
    expect(powershell).toContain('Remove-Item Env:NODEACCESS_MCP_TOKEN')
    expect(powershell).not.toContain('-MaskInput')
  })
  it.each(['https://user:secret@example.test/x', 'javascript:alert(1)', 'https://example.test/x?secret=x', 'https://example.test/x#secret', 'https://example.test/\ncommand'])('rejects unsafe endpoint %s', (url) => {
    expect(() => validateMcpEndpoint(url)).toThrow()
  })
  it('quotes shell metacharacters without interpolation', () => {
    const url = "https://example.test/$(touch${IFS}bad);'"
    expect(buildMcpAgentSetup(url).register).toContain(`'"'"'`)
    expect(buildMcpAgentSetup(url, 'codex', 'powershell').register).toContain("''")
  })
  it('explains local and insecure origins', () => {
    expect(buildMcpAgentSetup('http://localhost:3000/api/v1/mcp/jsonrpc')).toMatchObject({ local: true, insecure: true })
    expect(buildMcpAgentSetup(endpoint)).toMatchObject({ local: false, insecure: false })
  })
})
