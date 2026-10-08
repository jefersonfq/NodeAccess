import { z } from 'zod'

export const TerminalHighlightMatchModeSchema = z.enum(['literal', 'wildcard', 'regex'])
export const TerminalHighlightColorSchema = z.enum(['red', 'amber', 'orange', 'green', 'blue', 'cyan', 'purple', 'gray'])

export const TerminalHighlightRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  pattern: z.string().min(1).max(160),
  mode: TerminalHighlightMatchModeSchema.default('literal'),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(true),
  foreground: TerminalHighlightColorSchema,
  background: TerminalHighlightColorSchema.nullable().default(null),
  bold: z.boolean().default(false),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(50),
})

export const TerminalHighlightRulesSchema = z.array(TerminalHighlightRuleSchema).max(40)

export const SaveTerminalHighlightPreferenceSchema = z.object({
  enabled: z.boolean(),
  rules: TerminalHighlightRulesSchema,
})

export const SaveTerminalHighlightTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
  rules: TerminalHighlightRulesSchema,
  userIds: z.array(z.number().int().positive()).max(500).default([]),
  groupIds: z.array(z.number().int().positive()).max(200).default([]),
})

export const TerminalHighlightTelemetrySchema = z.object({
  templateIds: z.array(z.number().int().positive()).max(40).default([]),
  durationMs: z.number().min(0).max(60_000),
  bytesProcessed: z.number().int().min(0).max(10_000_000),
  matchCount: z.number().int().min(0).max(100_000),
  ruleCount: z.number().int().min(0).max(40),
  matchedRuleIds: z.array(z.string().uuid()).max(40).default([]),
  budgetExceeded: z.boolean(),
})

export type TerminalHighlightRule = z.infer<typeof TerminalHighlightRuleSchema>
export type SaveTerminalHighlightPreferenceDto = z.infer<typeof SaveTerminalHighlightPreferenceSchema>
export type SaveTerminalHighlightTemplateDto = z.infer<typeof SaveTerminalHighlightTemplateSchema>
export type TerminalHighlightTelemetryDto = z.infer<typeof TerminalHighlightTelemetrySchema>
