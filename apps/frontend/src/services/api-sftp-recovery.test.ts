import { it, expect } from 'vitest'
import { isLocalSftpRecoveryRequest } from './api-auth-classification'
it('keeps SFTP network/permission recovery scoped to files', () => {
  for (const url of ['/sftp/10/list?path=/tmp/private', '/sftp/10/download', '/sftp/10/upload', '/hosts/10/sftp']) expect(isLocalSftpRecoveryRequest({ url })).toBe(true)
  expect(isLocalSftpRecoveryRequest({ url: '/auth/refresh' })).toBe(false)
  expect(isLocalSftpRecoveryRequest({ url: '/hosts' })).toBe(false)
})
