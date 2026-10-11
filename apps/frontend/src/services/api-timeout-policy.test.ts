import { expect, it } from 'vitest'
import { apiRequestTimeout } from './api-timeout-policy'
it.each([['/hosts', 30000], ['/auth/refresh', 30000], ['/sftp/42/upload', 300000], ['/session-audit/1/export', 300000], ['/integrations/jira/test', 120000], ['/local-ai/chat', 300000]])('bounds %s without cutting slow transfers at the ordinary API deadline', (url, timeout) => {
  expect(apiRequestTimeout(url)).toBe(timeout)
})
