import { z } from 'zod'

export const MACRO_PREFIX = '#!nodeaccess:macro-v1'
const text = z.string().min(1).max(8192)
export const MacroStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send'), text, enter: z.boolean() }).strict(),
  z.object({ type: z.literal('wait'), pattern: z.string().min(1).max(512), mode: z.enum(['literal', 'regex']), caseSensitive: z.boolean(), timeoutMs: z.number().int().min(100).max(300000) }).strict(),
  z.object({ type: z.literal('pause'), durationMs: z.number().int().min(0).max(300000) }).strict(),
  z.object({ type: z.literal('key'), key: z.enum(['ENTER', 'TAB', 'ESC']) }).strict(),
])
export const MacroSchema = z.object({ version: z.literal(1), steps: z.array(MacroStepSchema).min(1).max(200) }).strict()
export type MacroStep = z.infer<typeof MacroStepSchema>
export type SnippetMacro = z.infer<typeof MacroSchema>

export function validateSnippetCommand(command: string): boolean {
  if (!command.trim() || new TextEncoder().encode(command).length > 60000) return false
  if (!command.startsWith('#!nodeaccess:')) return true
  const newline = command.indexOf('\n')
  const prefix = command.slice(0, newline)
  try {
    const data: unknown = JSON.parse(command.slice(newline + 1))
    if (prefix === MACRO_PREFIX) return MacroSchema.safeParse(data).success
    if (prefix === '#!nodeaccess:sequence') return z.object({ steps: z.array(text).min(1).max(200) }).strict().safeParse(data).success
    if (prefix === '#!nodeaccess:expect-send') return z.object({ steps: z.array(z.object({ expect: text, send: text }).strict()).min(1).max(200) }).strict().safeParse(data).success
    return false
  } catch { return false }
}

export const SnippetCommandSchema = z.string().refine(validateSnippetCommand, 'Invalid snippet or macro steps')

export const MacroOutcomeSchema = z.object({
  executionId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/),
  status: z.enum(['completed', 'cancelled', 'failed']),
  step: z.number().int().min(0).max(200),
  total: z.number().int().min(1).max(200),
  reason: z.enum(['cancelled', 'timeout', 'regexBudget', 'invalidRegex', 'invalidSteps', 'disconnected']).optional(),
}).strict().refine(value => value.step <= value.total, 'Invalid progress')
export type MacroOutcome = z.infer<typeof MacroOutcomeSchema>
