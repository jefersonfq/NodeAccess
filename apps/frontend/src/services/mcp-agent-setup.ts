export type McpAgent = 'codex' | 'claude' | 'gemini'
export type McpShell = 'bash' | 'powershell'

export function validateMcpEndpoint(value: string): URL {
  if (/[\u0000-\u0020\u007f]/.test(value)) throw new Error('Informe uma URL sem espaços ou caracteres de controle.')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use uma URL HTTP(S), sem credenciais, parâmetros ou fragmentos.')
  }
  return url
}

function quoteShell(value: string, shell: McpShell): string {
  return shell === 'bash' ? "'" + value.replaceAll("'", "'\"'\"'") + "'" : "'" + value.replaceAll("'", "''") + "'"
}

export interface McpAgentSetup {
  endpoint: string
  config: string
  start: string
  local: boolean
  insecure: boolean
  register: string | null
  destination: string
  verify: string
}

export function buildMcpAgentSetup(endpoint: string, agent: McpAgent = 'codex', shell: McpShell = 'bash'): McpAgentSetup {
  const url = validateMcpEndpoint(endpoint)
  const local = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)
  const config = agent === 'codex'
    ? `[mcp_servers.nodeaccess]\nurl = ${JSON.stringify(url.href)}\nbearer_token_env_var = "NODEACCESS_MCP_TOKEN"`
    : JSON.stringify({ mcpServers: { nodeaccess: {
      ...(agent === 'claude' ? { type: 'http', url: url.href } : { httpUrl: url.href }),
      headers: { Authorization: 'Bearer ${NODEACCESS_MCP_TOKEN}' },
    } } }, null, 2)
  const start = shell === 'bash'
    ? `(\n  read -rsp "Token MCP: " NODEACCESS_MCP_TOKEN; printf '\\n'\n  export NODEACCESS_MCP_TOKEN\n  ${agent}\n)`
    : `$mcpSecret = Read-Host "Token MCP" -AsSecureString\n$mcpPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($mcpSecret)\ntry {\n  $env:NODEACCESS_MCP_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($mcpPointer)\n  ${agent}\n} finally {\n  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($mcpPointer)\n  Remove-Item Env:NODEACCESS_MCP_TOKEN -ErrorAction SilentlyContinue\n  $mcpSecret.Dispose()\n}`
  return {
    endpoint: url.href, config, start, local, insecure: url.protocol === 'http:',
    register: agent === 'codex' ? `codex mcp add nodeaccess --url ${quoteShell(url.href, shell)} --bearer-token-env-var NODEACCESS_MCP_TOKEN` : null,
    destination: agent === 'codex' ? '~/.codex/config.toml (Windows: %USERPROFILE%\\.codex\\config.toml)'
      : agent === 'claude' ? '.mcp.json na raiz do projeto (escopo de projeto)'
        : '~/.gemini/settings.json (Windows: %USERPROFILE%\\.gemini\\settings.json)',
    verify: agent === 'codex' ? 'No Codex, abra /mcp.' : agent === 'claude' ? 'No Claude Code, abra /mcp e aprove o servidor do projeto, se solicitado.' : 'No Gemini CLI, abra /mcp list. Se a pasta não for confiável, revise o projeto antes de autorizar o acesso.',
  }
}
