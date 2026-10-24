import type { SnippetKind } from '@/services/snippet.service'

export interface SnippetCardMeta {
  kind: SnippetKind
  preview: string
  secretAliases: string[]
  stepCount: number
}
