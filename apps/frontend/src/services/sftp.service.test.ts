import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ post: vi.fn().mockResolvedValue({}) }))
vi.mock('./api', () => ({ default: { post: mocks.post } }))
import { getSftpErrorMessage, sftpService } from './sftp.service'

describe('SFTP request contract and failure feedback', () => {
  it('sends mkdir path and audit context in the request body', async () => {
    await sftpService.mkdir(10, '/tmp/ação', { sessionId: 77 })
    expect(mocks.post).toHaveBeenCalledWith('/sftp/10/mkdir', { path: '/tmp/ação', sessionId: 77 })
  })
  it('reads JSON error messages returned as a download Blob', async () => {
    expect(await getSftpErrorMessage({ response: { data: new Blob([JSON.stringify({ message: 'Permissão negada' })]) } }, 'Fallback')).toBe('Permissão negada')
  })
  it.each([new Blob(['invalid JSON']), { message: 42 }, undefined])('uses a safe fallback for unsupported responses', async data => {
    expect(await getSftpErrorMessage({ response: { data } }, 'Fallback')).toBe('Fallback')
  })
})
