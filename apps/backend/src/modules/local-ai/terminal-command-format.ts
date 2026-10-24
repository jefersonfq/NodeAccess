/** Remove presentation wrappers only for a plain executable, optionally followed by arguments.
 * Quoted paths remain untouched; policy evaluates the final text.
 */
export function normalizeSuggestedCommand(value: string): string {
  let text = value.trim()
  // Accept only a single command line inside a complete Markdown code block.
  // Never collapse a multiline script into an insertable command.
  const fenced = text.match(/^```(?:bash|sh|shell|console|powershell|cmd)?[ \t]*\r?\n([^\r\n]+)\r?\n```$/i)
  if (fenced) text = fenced[1]!.trim()
  const inline = text.match(/^`([^`\r\n]+)`$/)
  if (inline) text = inline[1]!.trim()
  const quote = text[0]
  if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
    const inner = text.slice(1, -1)
    if (/^[a-zA-Z][a-zA-Z0-9_.-]*(?:[ \t]+\S[\s\S]*)?$/.test(inner) && !inner.includes(quote)) return inner
  }
  return text
}

export function isInsertableSuggestedCommand(command: string): boolean {
  return command.length > 0 && command.length <= 8192
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(command)
    && !/^(['"]).*\1$/s.test(command) && !command.startsWith('```')
}
