export const MCP_ACTION_MODES = [
  'read_only',
  'diagnostic_only',
  'approval_required',
  'full_operational_access',
] as const

export type McpActionMode = typeof MCP_ACTION_MODES[number]

const MODE_LEVEL: Record<McpActionMode, number> = {
  read_only: 0,
  diagnostic_only: 1,
  approval_required: 2,
  full_operational_access: 3,
}

export function isMcpActionMode(value: string): value is McpActionMode {
  return MCP_ACTION_MODES.includes(value as McpActionMode)
}

export function expandMcpActionModes(configuredModes?: string[]): McpActionMode[] {
  if (!configuredModes?.length) return [...MCP_ACTION_MODES]
  const highestLevel = configuredModes
    .filter(isMcpActionMode)
    .reduce((highest, mode) => Math.max(highest, MODE_LEVEL[mode]), -1)
  if (highestLevel < 0) return []
  return MCP_ACTION_MODES.filter((mode) => MODE_LEVEL[mode] <= highestLevel)
}

export function isMcpActionModeAllowed(configuredModes: string[] | undefined, requestedMode: string): boolean {
  if (!configuredModes?.length) return true
  if (!isMcpActionMode(requestedMode)) return false
  return expandMcpActionModes(configuredModes).includes(requestedMode)
}
