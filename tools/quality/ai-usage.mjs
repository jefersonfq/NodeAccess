// Aggregates local Codex and Claude Code token usage for a date window.
// Prints only counters and file names: no prompts, outputs, commands or secrets.
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REVIEWER_MARKER = 'judging one planned'

export function newCodexSession() {
  return { kind: 'main', input: 0, cached: 0, output: 0, reasoning: 0, lastContext: 0, escalations: 0, compactions: 0, seenFirstDeveloper: false }
}

// Codex rollout line: { type, payload }. token_count totals are cumulative, so keep the last one.
export function addCodexLine(session, line) {
  let record
  try { record = JSON.parse(line) } catch { return session }
  const payload = record?.payload ?? {}
  if (record.type === 'compacted' || payload.type === 'context_compacted') session.compactions += 1
  if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'developer' && !session.seenFirstDeveloper) {
    session.seenFirstDeveloper = true
    const text = (payload.content ?? []).map(part => part?.text ?? '').join('')
    if (text.includes(REVIEWER_MARKER)) session.kind = 'reviewer'
  }
  if (record.type === 'event_msg' && payload.type === 'token_count' && payload.info) {
    const total = payload.info.total_token_usage ?? {}
    session.input = total.input_tokens ?? session.input
    session.cached = total.cached_input_tokens ?? session.cached
    session.output = total.output_tokens ?? session.output
    session.reasoning = total.reasoning_output_tokens ?? session.reasoning
    session.lastContext = payload.info.last_token_usage?.input_tokens ?? session.lastContext
  }
  if (record.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(payload.type)) {
    const args = String(payload.arguments ?? payload.input ?? '')
    session.escalations += args.split('require_escalated').length - 1
  }
  return session
}

export function newClaudeSession() {
  return { kind: 'claude', input: 0, cached: 0, cacheWrite: 0, output: 0, lastContext: 0, requests: 0, seen: new Set() }
}

// Claude Code transcript: assistant lines carry message.usage; one request may span several lines.
export function addClaudeLine(session, line) {
  let record
  try { record = JSON.parse(line) } catch { return session }
  const usage = record?.type === 'assistant' ? record.message?.usage : null
  if (!usage) return session
  const key = record.requestId ?? record.message?.id ?? record.uuid
  if (key && session.seen.has(key)) return session
  if (key) session.seen.add(key)
  const fresh = usage.input_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  const write = usage.cache_creation_input_tokens ?? 0
  session.requests += 1
  session.input += fresh + read + write
  session.cached += read
  session.cacheWrite += write
  session.output += usage.output_tokens ?? 0
  session.lastContext = fresh + read + write
  return session
}

export function summarize(sessions, top = 5) {
  const groups = {}
  for (const s of sessions) {
    const g = groups[s.kind] ??= { sessions: 0, input: 0, cached: 0, uncached: 0, output: 0, escalations: 0, compactions: 0 }
    g.sessions += 1; g.input += s.input; g.cached += s.cached; g.uncached += Math.max(0, s.input - s.cached)
    g.output += s.output; g.escalations += s.escalations ?? 0; g.compactions += s.compactions ?? 0
  }
  const largest = [...sessions].sort((a, b) => b.input - a.input).slice(0, top)
    .map(s => ({ kind: s.kind, file: s.file, input: s.input, cachedPercent: s.input ? Math.round(100 * s.cached / s.input) : 0, lastContext: s.lastContext }))
  return { groups, largest, note: 'Local transcript counters only; cached input is billed/limited differently from uncached input.' }
}

function listJsonl(dir, since, until) {
  const out = []
  const walk = current => {
    let entries
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.jsonl')) {
        const mtime = statSync(full).mtime
        if (mtime >= since && mtime < until) out.push(full)
      }
    }
  }
  walk(dir)
  return out
}

async function readSession(file, create, add) {
  const session = create()
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) add(session, line)
  delete session.seen; delete session.seenFirstDeveloper
  session.file = basename(file)
  return session
}

export function parseArgs(argv, now = new Date()) {
  const opts = { since: new Date(now.getTime() - 14 * 86400000), until: now, codexDir: join(homedir(), '.codex/sessions'), claudeDir: join(homedir(), '.claude/projects'), top: 5 }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, value] = [argv[i], argv[i + 1]]
    if (flag === '--since') { opts.since = new Date(value); i += 1 }
    else if (flag === '--until') { opts.until = new Date(value); i += 1 }
    else if (flag === '--codex-dir') { opts.codexDir = resolve(value); i += 1 }
    else if (flag === '--claude-dir') { opts.claudeDir = resolve(value); i += 1 }
    else if (flag === '--top') { opts.top = Number(value); i += 1 }
    else throw new Error(`AI_USAGE_UNKNOWN_FLAG ${flag}`)
  }
  if (Number.isNaN(opts.since.getTime()) || Number.isNaN(opts.until.getTime())) throw new Error('AI_USAGE_INVALID_DATE')
  return opts
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2))
  const codex = await Promise.all(listJsonl(opts.codexDir, opts.since, opts.until).map(f => readSession(f, newCodexSession, addCodexLine)))
  const claude = await Promise.all(listJsonl(opts.claudeDir, opts.since, opts.until).map(f => readSession(f, newClaudeSession, addClaudeLine)))
  console.log(JSON.stringify({ window: { since: opts.since.toISOString(), until: opts.until.toISOString() },
    codex: summarize(codex, opts.top), claude: summarize(claude, opts.top) }, null, 2))
}
