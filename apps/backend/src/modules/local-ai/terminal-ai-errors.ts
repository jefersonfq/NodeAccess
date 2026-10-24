import { ZodError } from 'zod'
import { AppError } from '../../shared/errors.js'
export function terminalAiError(error: unknown, signal?: AbortSignal): AppError {
  const reason: unknown = signal?.reason
  const timeout = reason instanceof Error && reason.name === 'TimeoutError'
  if (signal?.aborted) return new AppError('Consulta de IA encerrada.', timeout ? 504 : 499, timeout ? 'AI_TIMEOUT' : 'AI_CANCELED')
  if (error instanceof AppError) {
    if (/licenciad/i.test(error.message)) return new AppError('IA não licenciada para este acesso.',403,'AI_LICENSE')
    return error
  }
  if (error instanceof SyntaxError || error instanceof ZodError) return new AppError('A IA retornou uma resposta fora do formato esperado.',502,'AI_RESPONSE_INVALID')
  const text = error instanceof Error ? error.name + ' ' + error.message : ''
  if (/HTTP 429|rate.?limit/i.test(text)) return new AppError('Limite de consultas do provedor atingido.',429,'AI_RATE_LIMIT')
  if (/timeout|timed out|aborterror/i.test(text)) return new AppError('A IA demorou para responder.',504,'AI_TIMEOUT')
  if (/HTTP (400|401|403|404)/i.test(text)) return new AppError('Verifique a configuração e o suporte do modelo à resposta estruturada.',503,'AI_PROVIDER_CONFIGURATION')
  return new AppError('O provedor de IA está indisponível.',503,'AI_UNAVAILABLE')
}
