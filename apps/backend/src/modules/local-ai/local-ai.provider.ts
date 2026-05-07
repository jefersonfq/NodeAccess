export interface LocalAiProviderChatInput {
  model: string
  systemPrompt: string
  userMessage: string
}

export interface LocalAiProviderChatOutput {
  answer: string
}

export interface LocalAiProvider {
  chat(input: LocalAiProviderChatInput): Promise<LocalAiProviderChatOutput>
  chatStream(input: LocalAiProviderChatInput): AsyncGenerator<string>
}
