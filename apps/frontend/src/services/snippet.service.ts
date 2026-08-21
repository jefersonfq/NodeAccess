import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'
export { groupSnippets } from './snippet-grouping.service'
export type { SnippetBucket } from './snippet-grouping.service'

const SEQUENCE_PREFIX = '#!nodeaccess:sequence'
const EXPECT_SEND_PREFIX = '#!nodeaccess:expect-send'
const SECRET_PLACEHOLDER_RE = /\{\{\s*secret:([a-zA-Z0-9._:-]+)\s*\}\}/g
const SENSITIVE_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'mysqlInlinePassword', pattern: /\b(mysql|mariadb)\b[^\n]*\s-p\S+/i },
  { key: 'passwordAssignment', pattern: /\b(pass(word)?|pwd|token|secret)\s*=\s*['"]?[^'"\s{][^'"\s]*/i },
  { key: 'curlBasicAuth', pattern: /\bcurl\b[^\n]*\s-u\s+[^:\s]+:[^\s]+/i },
  { key: 'psqlPasswordEnv', pattern: /\bPGPASSWORD\s*=\s*['"]?[^'"\s{][^'"\s]*/i },
]

export type SnippetKind = 'COMMAND' | 'SEQUENCE' | 'EXPECT_SEND'

// ── SnippetGroup ──────────────────────────────────────────────────────────────

export interface SnippetGroup {
  id:          number
  name:        string
  description: string | null
  scope:       'PERSONAL' | 'TEAM'
  createdById: number
  createdAt:   string
  updatedAt:   string
}

export interface CreateSnippetGroupDto {
  name:         string
  description?: string | null
  scope:        'PERSONAL' | 'TEAM'
}

// ── Snippet ───────────────────────────────────────────────────────────────────

export interface Snippet {
  id:          number
  name:        string
  command:     string
  description: string | null
  scope:       'PERSONAL' | 'TEAM'
  groupId:     number | null
  group:       { id: number; name: string; scope: 'PERSONAL' | 'TEAM' } | null
  createdAt:   string
  updatedAt:   string
  createdBy:   { id: number; name: string }
}

export interface SnippetFormData {
  name:         string
  description?: string
  scope:        'PERSONAL' | 'TEAM'
  groupId?:     number | null
  kind:         SnippetKind
  command:      string
  stepsText:    string
  expectSendText: string
}

export interface CreateSnippetDto {
  name:         string
  command:      string
  description?: string | null
  scope:        'PERSONAL' | 'TEAM'
  groupId?:     number | null
}

export interface SnippetExecution {
  name?: string
  kind: SnippetKind
  command: string
  steps: string[]
  expectSteps: Array<{ expect: string; send: string }>
}

// ── Grouped view helpers ──────────────────────────────────────────────────────

// ── Scope mismatch warning ────────────────────────────────────────────────────

/** Retorna true se o snippet for PERSONAL mas o grupo for TEAM.
 *  Nesse caso, o snippet ficará visível para outros membros via o grupo.
 */
export function hasGroupScopeMismatch(
  snippetScope: 'PERSONAL' | 'TEAM',
  groupScope: 'PERSONAL' | 'TEAM' | null | undefined,
): boolean {
  return snippetScope === 'PERSONAL' && groupScope === 'TEAM'
}

// ── Serialization ─────────────────────────────────────────────────────────────

export function extractSecretAliases(text: string): string[] {
  const aliases = new Set<string>()
  for (const match of text.matchAll(SECRET_PLACEHOLDER_RE)) {
    if (match[1]) aliases.add(match[1])
  }
  return [...aliases]
}

export function getSnippetExecutionSecretAliases(execution: SnippetExecution): string[] {
  const chunks = [
    execution.command,
    ...execution.steps,
    ...execution.expectSteps.flatMap((step) => [step.expect, step.send]),
  ]
  const aliases = new Set<string>()
  for (const chunk of chunks) {
    for (const alias of extractSecretAliases(chunk)) aliases.add(alias)
  }
  return [...aliases]
}

export function getSnippetSecretAliases(snippet: Snippet): string[] {
  return getSnippetExecutionSecretAliases(deserializeSnippetCommand(snippet.command))
}

export function maskSecretPlaceholders(text: string): string {
  return text.replace(SECRET_PLACEHOLDER_RE, (_match, alias: string) => `{{secret:${alias}:***}}`)
}

export function getSnippetSensitivePatternKeys(execution: SnippetExecution): string[] {
  const chunks = [
    execution.command,
    ...execution.steps,
    ...execution.expectSteps.map((step) => step.send),
  ]
  const keys = new Set<string>()
  for (const chunk of chunks) {
    const withoutPlaceholders = chunk.replace(SECRET_PLACEHOLDER_RE, '{{secret}}')
    for (const item of SENSITIVE_PATTERNS) {
      if (item.pattern.test(withoutPlaceholders)) keys.add(item.key)
    }
  }
  return [...keys]
}

export function getSequenceSteps(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function getExpectSendSteps(text: string): Array<{ expect: string; send: string }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [expect, ...rest] = line.split('=>')
      return {
        expect: (expect ?? '').trim(),
        send: rest.join('=>').trim(),
      }
    })
    .filter((step) => step.expect.length > 0 && step.send.length > 0)
}

export function deserializeSnippetCommand(command: string | null | undefined): SnippetExecution {
  command = typeof command === 'string' ? command : ''
  if (command.startsWith(`${EXPECT_SEND_PREFIX}\n`)) {
    const raw = command.slice(EXPECT_SEND_PREFIX.length + 1)

    try {
      const parsed = JSON.parse(raw) as { steps?: Array<{ expect?: string; send?: string }> }
      const expectSteps = Array.isArray(parsed.steps)
        ? parsed.steps
          .map((step) => ({
            expect: String(step.expect ?? '').trim(),
            send: String(step.send ?? '').trim(),
          }))
          .filter((step) => step.expect.length > 0 && step.send.length > 0)
        : []

      return {
        kind: 'EXPECT_SEND',
        command: expectSteps.map((step) => `${step.expect} => ${step.send}`).join('\n'),
        steps: expectSteps.map((step) => step.send),
        expectSteps,
      }
    } catch {
      return {
        kind: 'COMMAND',
        command,
        steps: getSequenceSteps(command),
        expectSteps: [],
      }
    }
  }

  if (!command.startsWith(`${SEQUENCE_PREFIX}\n`)) {
    return {
      kind: 'COMMAND',
      command,
      steps: getSequenceSteps(command),
      expectSteps: [],
    }
  }

  const raw = command.slice(SEQUENCE_PREFIX.length + 1)

  try {
    const parsed = JSON.parse(raw) as { steps?: string[] }
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.map((step) => String(step).trim()).filter((step) => step.length > 0)
      : []

    return {
      kind: 'SEQUENCE',
      command: steps.join('\n'),
      steps,
      expectSteps: [],
    }
  } catch {
    return {
      kind: 'COMMAND',
      command,
      steps: getSequenceSteps(command),
      expectSteps: [],
    }
  }
}

export function serializeSnippetForm(form: SnippetFormData): CreateSnippetDto {
  if (form.kind === 'EXPECT_SEND') {
    const steps = getExpectSendSteps(form.expectSendText)
    return {
      name: form.name,
      description: form.description ?? null,
      scope: form.scope,
      groupId: form.groupId ?? null,
      command: `${EXPECT_SEND_PREFIX}\n${JSON.stringify({ steps })}`,
    }
  }

  if (form.kind === 'SEQUENCE') {
    const steps = getSequenceSteps(form.stepsText)
    return {
      name: form.name,
      description: form.description ?? null,
      scope: form.scope,
      groupId: form.groupId ?? null,
      command: `${SEQUENCE_PREFIX}\n${JSON.stringify({ steps })}`,
    }
  }

  return {
    name: form.name,
    description: form.description ?? null,
    scope: form.scope,
    groupId: form.groupId ?? null,
    command: form.command,
  }
}

export function toSnippetFormData(snippet?: Snippet): SnippetFormData {
  if (!snippet) {
    return {
      name: '',
      description: '',
      scope: 'PERSONAL',
      groupId: null,
      kind: 'COMMAND',
      command: '',
      stepsText: '',
      expectSendText: '',
    }
  }

  const parsed = deserializeSnippetCommand(snippet.command)

  return {
    name: snippet.name,
    description: snippet.description ?? '',
    scope: snippet.scope,
    groupId: snippet.groupId ?? null,
    kind: parsed.kind,
    command: parsed.kind === 'COMMAND' ? parsed.command : '',
    stepsText: parsed.kind === 'SEQUENCE' ? parsed.steps.join('\n') : '',
    expectSendText: parsed.kind === 'EXPECT_SEND'
      ? parsed.expectSteps.map((step) => `${step.expect} => ${step.send}`).join('\n')
      : '',
  }
}

// ── API calls ─────────────────────────────────────────────────────────────────

const snippetListCache = createTimedPromiseCache<{ data: Snippet[] }>(cacheTtls.snippetsList, { name: 'snippets:list' })
const snippetGroupListCache = createTimedPromiseCache<{ data: SnippetGroup[] }>(cacheTtls.snippetGroupsList, { name: 'snippet-groups:list' })

function clearSnippetCaches(reason: string) {
  snippetListCache.clear(reason)
  snippetGroupListCache.clear(reason)
}

export const snippetService = {
  list() {
    return snippetListCache.get(() => api.get<Snippet[]>('/snippets'))
  },

  create(dto: CreateSnippetDto) {
    return api.post<Snippet>('/snippets', dto).then((res) => {
      clearSnippetCaches('snippet:create')
      return res
    })
  },

  update(id: number, dto: Partial<CreateSnippetDto>) {
    return api.put<Snippet>(`/snippets/${id}`, dto).then((res) => {
      clearSnippetCaches('snippet:update')
      return res
    })
  },

  remove(id: number) {
    return api.delete(`/snippets/${id}`).then((res) => {
      clearSnippetCaches('snippet:remove')
      return res
    })
  },
}

export const snippetGroupService = {
  list() {
    return snippetGroupListCache.get(() => api.get<SnippetGroup[]>('/snippet-groups'))
  },

  create(dto: CreateSnippetGroupDto) {
    return api.post<SnippetGroup>('/snippet-groups', dto).then((res) => {
      clearSnippetCaches('snippet-group:create')
      return res
    })
  },

  update(id: number, dto: Partial<CreateSnippetGroupDto>) {
    return api.put<SnippetGroup>(`/snippet-groups/${id}`, dto).then((res) => {
      clearSnippetCaches('snippet-group:update')
      return res
    })
  },

  remove(id: number) {
    return api.delete(`/snippet-groups/${id}`).then((res) => {
      clearSnippetCaches('snippet-group:remove')
      return res
    })
  },
}
