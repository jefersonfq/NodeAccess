export interface ManualArticle {
  id: string
  title: string
  summary: string
  journey: string[]
  reviewedAt: string
  html: string
  text: string
  flow: string
  screenshot: string | null
  reviewCurrent: boolean
}
export interface ManualBundle {
  version: string
  builtAt: string
  contentHash: string
  articles: ManualArticle[]
}
