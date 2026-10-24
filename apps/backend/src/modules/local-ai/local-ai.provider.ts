export interface LocalAiProviderChatInput {
  model: string
  systemPrompt: string
  userMessage: string
  responseFormat?: 'json'
  responseSchema?: Record<string, unknown>
  signal?: AbortSignal
}

export interface LocalAiProviderChatOutput {
  answer: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

export interface LocalAiProvider {
  chat(input: LocalAiProviderChatInput): Promise<LocalAiProviderChatOutput>
  chatStream(input: LocalAiProviderChatInput): AsyncGenerator<string>
}
