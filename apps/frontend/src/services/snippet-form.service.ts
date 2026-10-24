import { snippetFormError, type SnippetFormData } from './snippet.service'
import { createMacroMatcher } from './macro-regex.service'

export async function validateSnippetForm(form: SnippetFormData): Promise<string | null> {
  const invalid = snippetFormError(form)
  if (invalid) return invalid
  if (form.kind !== 'MACRO') return null
  const matcher = createMacroMatcher()
  try {
    for (const step of form.actions ?? []) {
      if (step.type === 'wait' && step.mode === 'regex') await matcher.match(step.pattern, '', step.caseSensitive, new AbortController().signal)
    }
    return null
  } catch { return 'snippets.macro.regexError' }
  finally { matcher.dispose() }
}
