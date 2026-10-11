import { describe, expect, it, vi } from 'vitest'
vi.mock('./api', () => ({ default: { post: vi.fn().mockResolvedValue({}) } }))
import api from './api'
import { getSftpErrorMessage, sftpService } from './sftp.service'

describe('SFTP request contract and failure feedback', () => {
  it('sends mkdir path and audit context in the request body', async () => {
    await sftpService.mkdir(10, '/tmp/ação', { sessionId: 77 })
    expect(api.post).toHaveBeenCalledWith('/sftp/10/mkdir', { path: '/tmp/ação', sessionId: 77 })
  })
  it('reads JSON error messages returned as a download Blob', async () => {
    expect(await getSftpErrorMessage({ response: { data: new Blob([JSON.stringify({ message: 'Permissão negada' })]) } }, 'Fallback')).toBe('Permissão negada')
  })
  it.each([new Blob(['invalid JSON']), { message: 42 }, undefined])('uses a safe fallback for unsupported responses', async data => {
    expect(await getSftpErrorMessage({ response: { data } }, 'Fallback')).toBe('Fallback')
  })
})
