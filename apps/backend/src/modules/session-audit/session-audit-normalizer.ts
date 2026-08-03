import type {
  SessionAuditCommand,
  SessionAuditCriticalEvent,
  SessionAuditEventType,
  SessionAuditPreviewEvent,
} from '@nodeaccess/shared'

// ─── Strip / normalize ───────────────────────────────────────────────────────

export function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()*+\-./][0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_][0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[=>78<MNOPQRS]/g, '')
}

export function replayInlineBackspaces(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] ?? ''
    if (char === '\b' || char === '\x7f') {
      result = result.slice(0, -1)
      continue
    }
    result += char
  }
  return result
}

export function normalizeTerminalInputChunk(value: string): string {
  return stripAnsi(value).replace(/[\u0000\u0007]/g, '')
}

export function normalizeTerminalOutput(value: string): string {
  return replayInlineBackspaces(stripAnsi(value)).replace(/[\u0000\u0007]/g, '')
}

// ─── Prompt detection ────────────────────────────────────────────────────────

export function looksLikePrompt(value: string): boolean {
  const line = value.trim()
  if (!line) return false
  return /^[\w.@:/~-]+[#$>%] ?$/.test(line)
    || /^\[[^\]]+\][#$>%] ?$/.test(line)
}

// ─── Output cleaning ─────────────────────────────────────────────────────────

export function removeTrailingPrompt(value: string): string {
  const lines = value.split('\n')
  while (lines.length > 0 && looksLikePrompt(lines[lines.length - 1] ?? '')) {
    lines.pop()
  }
  return lines.join('\n')
}

const MULTI_PROMPT_LINE = /^((?:\[[^\]\r\n]+\]|[\w.@:/~-]+)[#$>%]\s?){2,}$/

function collapseInlinePrompts(line: string): string {
  if (!MULTI_PROMPT_LINE.test(line.trim())) return line
  const first = line.match(/(?:\[[^\]\r\n]+\]|[\w.@:/~-]+)[#$>%]\s?/)
  return first ? (first[0] ?? line) : line
}

export function collapseConsecutivePrompts(value: string): string {
  const lines = value.split('\n').map(collapseInlinePrompts)
  const result: string[] = []
  let lastWasPrompt = false
  for (const line of lines) {
    const isPrompt = looksLikePrompt(line)
    if (isPrompt && lastWasPrompt) continue
    result.push(line)
    lastWasPrompt = isPrompt
  }
  return result.join('\n')
}

export function collapseNoise(value: string): string {
  return value
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
}

export function buildEchoVariants(command: string): string[] {
  return [
    command,
    `${command}\n`,
    `${command}\r\n`,
    ` ${command}`,
    ` ${command}\n`,
  ]
}

// ─── Interactive command detection ───────────────────────────────────────────

const INTERACTIVE_FIRST_TOKENS = new Set([
  'vim', 'vi', 'nano', 'top', 'htop', 'less', 'more',
  'watch', 'tmux', 'screen', 'man', 'journalctl',
])

const FULLSCREEN_FIRST_TOKENS = new Set([
  'vim', 'vi', 'nano', 'top', 'htop', 'watch', 'tmux', 'screen',
])

const GIT_PAGER_SUBCOMMANDS = new Set(['log', 'diff', 'show', 'blame', 'shortlog'])

export function isLikelyInteractiveCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/)
  const first = tokens[0]?.toLowerCase() ?? ''

  if (first === 'top' && tokens.some((token) => token === '-b' || token.startsWith('-b'))) return false

  if (INTERACTIVE_FIRST_TOKENS.has(first)) return true

  if (first === 'cat' && tokens.length === 1) return true

  if (first === 'git' && GIT_PAGER_SUBCOMMANDS.has(tokens[1]?.toLowerCase() ?? '')) return true

  if (first === 'ping' && !/(?:^|\s)-c\s*\d+\b/.test(command)) return true

  if (first === 'tail' && /(?:^|\s)-[a-zA-Z]*f/.test(command)) return true

  if (/\|\s*(less|more)\b/.test(command)) return true

  return false
}

const PAGER_STATUS_LINE = /^(?:lines?\s+\d+-\d+\/\d+.*|\(END\).*|--[Mm]ore--|END of file)$/
const INTERACTIVE_ERROR_LINE = /\b(permiss[aã]o negada|permission denied|error|erro|failed|falhou|not found|não encontrado)\b/i

function isLikelyFullscreenCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return FULLSCREEN_FIRST_TOKENS.has(first)
}

export function summarizeInteractiveOutput(command: string, output: string): string {
  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase() ?? 'comando interativo'
  const normalized = stripAnsi(output)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u001b/g, '')
    .replace(/\u009b/g, '')

  if (isLikelyFullscreenCommand(command)) {
    const errorLines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !looksLikePrompt(line))
      .filter((line) => line !== '~')
      .filter((line) => INTERACTIVE_ERROR_LINE.test(line))
      .slice(-4)
    const header = `Saída interativa contínua detectada para "${firstToken}". Aplicação de tela cheia detectada; use Preview/Download para a trilha bruta completa.`
    return errorLines.length > 0 ? [header, '', ...errorLines].join('\n') : header
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !PAGER_STATUS_LINE.test(line.trim()))
  const lastLines = lines.slice(-8)

  if (lastLines.length === 0) {
    return `Saída interativa contínua detectada para "${firstToken}". Use Preview/Download para a trilha bruta.`
  }

  return [
    `Saída interativa contínua detectada para "${firstToken}". Exibindo apenas as últimas linhas legíveis do buffer.`,
    '',
    ...lastLines,
  ].join('\n').trim()
}

export function cleanCommandOutput(output: string, command: string): string {
  if (isLikelyInteractiveCommand(command)) {
    return summarizeInteractiveOutput(command, output)
  }

  const noAnsi = normalizeTerminalOutput(output).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let cleaned = noAnsi.replace(/^\n+/, '')

  const commandVariants = buildEchoVariants(command)
  for (const variant of commandVariants) {
    if (cleaned.startsWith(variant)) {
      cleaned = cleaned.slice(variant.length).replace(/^\n+/, '')
      break
    }
  }

  cleaned = collapseConsecutivePrompts(cleaned)
  cleaned = removeTrailingPrompt(cleaned)
  cleaned = collapseConsecutivePrompts(cleaned)
  cleaned = collapseNoise(cleaned)

  return cleaned.trimEnd()
}

// ─── Command inference ────────────────────────────────────────────────────────

export function normalizeCommand(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim()
}

export function extractPromptCwd(rawOutput: string): string | null {
  const oscTitleMatch = rawOutput.match(/\x1b\]0;[^:\x07]*:(.+?)(?:\x07|\x1b\\)/)
  if (oscTitleMatch?.[1]) return oscTitleMatch[1].trim()

  const bracketPromptPathMatch = rawOutput.match(/(?:^|\r?\n)\[[^\]@\r\n]+@[^\]\s\r\n]+\s+([^\]\r\n]+)\][#>$%]/)
  if (bracketPromptPathMatch?.[1]) {
    const bracketPath = bracketPromptPathMatch[1].trim()
    if (bracketPath.startsWith('/') || bracketPath.startsWith('~')) return bracketPath
  }

  const promptPathMatch = rawOutput.match(/(?:^|\r?\n)[^@\r\n]+@[^:\r\n]+:(.+?)(?:[#>$%])/)
  if (promptPathMatch?.[1]) return promptPathMatch[1].trim()

  return null
}

export function resolveCommand(command: string, rawOutput: string): string {
  const normalizedCommand = normalizeCommand(command)

  const editorResolvedCommand = resolveEditorCommandFromOutput(command, rawOutput)
  if (editorResolvedCommand) return editorResolvedCommand

  const redirectMatch = stripAnsi(rawOutput).match(/Redirecting to \/bin\/systemctl\s+(start|stop|restart|status|enable|disable)\s+([A-Za-z0-9_.@-]+)\.service/i)
  if (redirectMatch) {
    const action = redirectMatch[1]?.toLowerCase()
    const service = redirectMatch[2]
    if (action && service) {
      if (normalizedCommand.toLowerCase().includes(service.toLowerCase()) && normalizedCommand.toLowerCase().includes(action)) {
        return normalizedCommand
      }
      return normalizeCommand(`service ${service} ${action}`)
    }
  }

  if (/^cd(?:\s|$)/i.test(normalizedCommand)) {
    const cwd = extractPromptCwd(rawOutput)
    if (cwd) return normalizeCommand(`cd ${cwd}`)
  }

  return normalizedCommand
}

function resolveEditorCommandFromOutput(command: string, rawOutput: string): string | null {
  const normalizedCommand = normalizeCommand(command)
  const tokens = normalizedCommand.split(/\s+/).filter(Boolean)
  const firstToken = tokens[0]?.toLowerCase() ?? ''
  if (!['vim', 'vi', 'nano'].includes(firstToken)) return null

  const openedFile = stripAnsi(rawOutput).match(/"([^"\r\n]+)"\s+(?:\[[^\]\r\n]+\]\s+)?\d+L,\s*\d+C/i)?.[1]
  if (!openedFile) return null

  if (!command.includes('\t') && normalizedCommand.includes(openedFile)) return normalizedCommand

  const preservedOptions = tokens.slice(1).filter((token) => token.startsWith('-'))
  return normalizeCommand([tokens[0] ?? firstToken, ...preservedOptions, openedFile].join(' '))
}

export function inferConfidence(command: string, output: string): 'low' | 'medium' | 'high' {
  if (!command.trim()) return 'low'
  if (isLikelyInteractiveCommand(command)) return 'low'
  if (output.length === 0) return 'medium'
  if (output.includes(command)) return 'medium'
  if (looksLikePrompt(output)) return 'medium'
  return 'high'
}

export function hasMeaningfulOutput(output: string): boolean {
  const normalized = collapseNoise(output).trim()
  if (!normalized) return false
  if (looksLikePrompt(normalized)) return false
  return true
}

// ─── Command timeline ─────────────────────────────────────────────────────────

function isPrintableInputChar(char: string): boolean {
  return char >= ' ' && char !== '\u007f'
}

function consumeEscapeSequence(value: string, start: number): number {
  let i = start + 1
  while (i < value.length) {
    const char = value[i] ?? ''
    if ((char >= '@' && char <= '~') || char === '\u0007') return i + 1
    i += 1
  }
  return value.length
}

function applyInputChunk(currentBuffer: string, chunk: string, actorUserId: number | null): {
  remaining: string
  submitted: Array<{ command: string; actorUserId: number | null }>
} {
  const submitted: Array<{ command: string; actorUserId: number | null }> = []
  let buffer = currentBuffer
  const normalized = normalizeTerminalInputChunk(chunk)

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i] ?? ''

    if (char === '\x1b') { i = consumeEscapeSequence(normalized, i) - 1; continue }
    if (char === '\x03') { buffer = ''; continue }
    if (char === '\r' || char === '\n') {
      const command = buffer.trim()
      if (command) submitted.push({ command, actorUserId })
      buffer = ''
      continue
    }
    if (char === '\b' || char === '\x7f') { buffer = buffer.slice(0, -1); continue }
    if (char === '\u0000') continue
    if (char === '\t') { buffer += '\t'; continue }
    if (isPrintableInputChar(char)) buffer += char
  }

  return { remaining: buffer, submitted }
}

function isLikelyInteractiveExitCommand(command: string, previousCommand: string | null): boolean {
  const normalized = command.trim().toLowerCase()
  if (!previousCommand || !isLikelyInteractiveCommand(previousCommand)) return false
  return ['q', 'quit', 'exit', ':q', ':q!', 'zz'].includes(normalized)
}

function isPlausibleShellCommand(command: string): boolean {
  const normalized = command.trim()
  if (!normalized) return false
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(normalized)) return true
  if (!/^[a-zA-Z0-9_./:@%+=-]+(\s+.*)?$/.test(normalized)) return false
  const firstToken = normalized.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (firstToken.length >= 2) return true
  return ['.', '..', '/'].includes(firstToken)
}

function shouldIgnoreCommand(command: string, output: string, previous: SessionAuditCommand | null): boolean {
  const normalized = command.trim()
  if (!normalized) return true
  if (normalized.includes('{{secret:')) return true
  if (isLikelyInteractiveExitCommand(normalized, previous?.command ?? null)) return true
  if (!isPlausibleShellCommand(normalized) && !hasMeaningfulOutput(output)) return true
  return false
}

function finalizeCommand(
  index: number,
  input: { command: string; submittedAt: string; outputEndedAt: string | null; output: string; actorUserId: number | null },
  previous: SessionAuditCommand | null,
): SessionAuditCommand | null {
  const resolvedCommand = resolveCommand(input.command, input.output)
  const cleanedOutput = cleanCommandOutput(input.output, resolvedCommand)
  if (shouldIgnoreCommand(resolvedCommand, cleanedOutput, previous)) return null
  return {
    index,
    command: resolvedCommand,
    submittedAt: input.submittedAt,
    outputEndedAt: input.outputEndedAt,
    output: cleanedOutput,
    confidence: inferConfidence(resolvedCommand, cleanedOutput),
    actorUserId: input.actorUserId,
  }
}

function outputEndsWithPrompt(output: string): boolean {
  const normalized = collapseConsecutivePrompts(
    normalizeTerminalOutput(output).replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
  )
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const last = lines[lines.length - 1] ?? ''
  return looksLikePrompt(last) || /(?:\[[^\]]+\]|[\w.@:/~-]+)[#$>%]\s?$/.test(last)
}

function findCommandEchoIndex(output: string, command: string): number {
  const normalizedCommand = normalizeCommand(command)
  if (!normalizedCommand) return -1

  const escaped = normalizedCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = output.match(new RegExp(`(?:^|\\r?\\n|[#>$%] )${escaped}(?:\\r?\\n|\\r)`))
  if (!match || typeof match.index !== 'number') return -1

  const rawIndex = match.index
  const matched = match[0] ?? ''
  return matched.startsWith('\n') || matched.startsWith('\r\n') || /^[#>$%] /.test(matched)
    ? rawIndex + matched.indexOf(normalizedCommand)
    : rawIndex
}

function isActiveInteractiveInput(state: { activeCommand: { command: string; output: string } | null }, inputBuffer: string): boolean {
  const currentCommand = state.activeCommand
  return !!currentCommand
    && inputBuffer.length === 0
    && isLikelyInteractiveCommand(currentCommand.command)
    && !outputEndsWithPrompt(currentCommand.output)
}

export function buildCommandTimeline(events: SessionAuditPreviewEvent[]): SessionAuditCommand[] {
  const commands: SessionAuditCommand[] = []
  let inputBuffer = ''
  type ActiveCommand = { command: string; submittedAt: string; outputEndedAt: string | null; output: string; actorUserId: number | null }
  const state: { activeCommand: ActiveCommand | null } = { activeCommand: null }
  const pendingCommands: Array<{ command: string; submittedAt: string; actorUserId: number | null }> = []

  const startNextCommand = () => {
    if (state.activeCommand) return
    const next = pendingCommands.shift()
    if (!next) return
    state.activeCommand = { ...next, outputEndedAt: null, output: '' }
  }

  const finalizeActiveCommand = () => {
    if (!state.activeCommand) return
    const finalized = finalizeCommand(commands.length + 1, state.activeCommand, commands[commands.length - 1] ?? null)
    if (finalized) commands.push(finalized)
    state.activeCommand = null
  }

  const splitOutputByPendingEcho = () => {
    while (state.activeCommand && pendingCommands.length > 0) {
      const next = pendingCommands[0]
      if (!next) return

      const echoIndex = findCommandEchoIndex(state.activeCommand.output, next.command)
      if (echoIndex < 0) return

      const nextOutput = state.activeCommand.output.slice(echoIndex)
      const outputEndedAt = state.activeCommand.outputEndedAt
      state.activeCommand.output = state.activeCommand.output.slice(0, echoIndex)
      finalizeActiveCommand()
      const queued = pendingCommands.shift()
      if (!queued) return
      state.activeCommand = { ...queued, outputEndedAt, output: nextOutput }
    }
  }

  for (const event of events) {
    if (event.type === 'stdin' && event.text) {
      if (isActiveInteractiveInput(state, inputBuffer)) {
        inputBuffer = ''
        continue
      }

      const currentCommand = state.activeCommand
      if (currentCommand && outputEndsWithPrompt(currentCommand.output) && inputBuffer.length === 0) {
        finalizeActiveCommand()
      }

      if (
        inputBuffer.length === 0
        && isLikelyInteractiveExitCommand(event.text, commands[commands.length - 1]?.command ?? null)
        && !/[\r\n]/.test(event.text)
      ) {
        continue
      }

      const parsed = applyInputChunk(inputBuffer, event.text, event.actorUserId)
      inputBuffer = parsed.remaining

      const activeAfterInput = state.activeCommand
      if (activeAfterInput && parsed.submitted.length > 0 && outputEndsWithPrompt(activeAfterInput.output)) {
        finalizeActiveCommand()
      }

      for (const submitted of parsed.submitted) {
        if (!submitted.command.trim()) continue
        if (submitted.command.includes('{{secret:')) continue
        pendingCommands.push({ command: submitted.command, submittedAt: event.timestamp, actorUserId: submitted.actorUserId })
      }
      startNextCommand()
      continue
    }

    const stdoutCommand: ActiveCommand | null = state.activeCommand
    if (event.type === 'stdout' && event.text && stdoutCommand) {
      stdoutCommand.output += event.text
      stdoutCommand.outputEndedAt = event.timestamp
      state.activeCommand = stdoutCommand
      splitOutputByPendingEcho()
      continue
    }

    if (event.type === 'session_ended' || event.type === 'session_error') {
      finalizeActiveCommand()
      startNextCommand()
      while (state.activeCommand) {
        finalizeActiveCommand()
        startNextCommand()
      }
    }
  }

  finalizeActiveCommand()
  startNextCommand()
  while (state.activeCommand) {
    finalizeActiveCommand()
    startNextCommand()
  }

  return commands
}

// ─── Critical events ─────────────────────────────────────────────────────────

export function extractLastToken(command: string): string | null {
  const parts = normalizeCommand(command).split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] ?? null : null
}

export function extractServiceState(output: string): string | null {
  const match = stripAnsi(output).match(/\b(active|inactive|dead|failed|running|stopped)\b/i)
  return match?.[1]?.toLowerCase() ?? null
}

export function extractRelevantOutputLine(output: string, pattern: RegExp): string | null {
  const line = stripAnsi(output).split('\n').map((item) => item.trim()).find((item) => pattern.test(item))
  return line ?? null
}

export function compactEvidence(values: Array<string | null | undefined>): string[] {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
    .slice(0, 5)
}

export function dedupeCriticalEvents(events: SessionAuditCriticalEvent[]): SessionAuditCriticalEvent[] {
  const seen = new Set<string>()
  const result: SessionAuditCriticalEvent[] = []
  for (const event of events) {
    const key = `${event.type}:${event.commandIndex}:${event.command}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(event)
  }
  return result
}

// ─── JSONL parsing ────────────────────────────────────────────────────────────

function decodePreviewText(payload: Record<string, unknown>): string | null {
  const data = payload.data
  const encoding = payload.encoding
  if (typeof data !== 'string') return null
  if (encoding === 'base64') {
    return Buffer.from(data, 'base64').toString('utf-8')
  }
  return data
}

export function parsePreviewLine(line: string): SessionAuditPreviewEvent | null {
  try {
    const raw = JSON.parse(line) as {
      seq?: number
      ts?: string
      type?: SessionAuditEventType
      payload?: Record<string, unknown>
    }
    if (typeof raw.seq !== 'number' || typeof raw.ts !== 'string' || typeof raw.type !== 'string') return null
    const payload = raw.payload ?? {}
    return {
      seq: raw.seq,
      timestamp: raw.ts,
      type: raw.type,
      text: decodePreviewText(payload),
      actorUserId: typeof payload.actorUserId === 'number' && Number.isFinite(payload.actorUserId) ? payload.actorUserId : null,
      bytes: typeof payload.bytes === 'number' && Number.isFinite(payload.bytes) ? payload.bytes : null,
      cols: typeof payload.cols === 'number' && Number.isFinite(payload.cols) ? payload.cols : null,
      rows: typeof payload.rows === 'number' && Number.isFinite(payload.rows) ? payload.rows : null,
    }
  } catch {
    return null
  }
}
