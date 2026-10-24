import { validateSnippetCommand } from '@nodeaccess/shared'
import type { Snippet } from './snippet.service'
export interface PortableSnippet { name: string; command: string; description: string | null }
export function exportSnippets(snippets: Snippet[]): string {
  return JSON.stringify({format:'nodeaccess-snippets',version:1,snippets:snippets.map(({name,command,description})=>({name,command,description}))},null,2)
}
export function parseSnippetImport(text: string): PortableSnippet[] {
  if (new TextEncoder().encode(text).length > 2_000_000) throw new Error('size')
  const data = JSON.parse(text) as {format?:unknown;version?:unknown;snippets?:unknown}
  if (data.format !== 'nodeaccess-snippets' || data.version !== 1 || !Array.isArray(data.snippets) || !data.snippets.length || data.snippets.length > 100) throw new Error('format')
  return data.snippets.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('snippet')
    const row = item as Record<string,unknown>
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 255 || typeof row.command !== 'string' || !validateSnippetCommand(row.command) || (row.description !== null && typeof row.description !== 'string')) throw new Error('snippet')
    return {name:row.name,command:row.command,description:row.description}
  })
}
