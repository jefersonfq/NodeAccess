vi.mock('@/services/api',()=>({default:{}}))
import { describe, it, expect, vi } from 'vitest'
import { MacroSchema } from '@nodeaccess/shared'
import { macroTemplate } from './macro-templates'
import { snippetPreview, deserializeSnippetCommand, serializeSnippetForm, toSnippetFormData } from './snippet.service'
describe('macro templates and readable preview', () => {
  it.each(['diagnostic', 'prompt'] as const)('round trips %s without shared mutable steps', kind => {
    const actions = macroTemplate(kind)
    expect(MacroSchema.safeParse({version:1,steps:actions}).success).toBe(true)
    actions.pop()
    expect(macroTemplate(kind).length).toBe(actions.length + 1)
    const payload = serializeSnippetForm({...toSnippetFormData(),name:'Example',kind:'MACRO',actions:macroTemplate(kind)})
    const execution = deserializeSnippetCommand(payload.command)
    expect(execution.actions).toEqual(macroTemplate(kind))
    expect(snippetPreview(execution, type=>type)).toContain('wait:')
    expect(snippetPreview(execution, type=>type)).toContain('send:')
  })
})
