import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({
  env: {
    PEM_ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

import { SftpService } from './sftp.service.js'
import { ForbiddenError } from '../../shared/errors.js'

describe('SftpService ACL', () => {
  it('bloqueia operacoes SFTP quando usuario tem visualizacao, mas nao conexao', async () => {
    const sshRepo = {
      findHostWithCredentials: vi.fn().mockResolvedValue({
        id:                10,
        tenantId:          1,
        ip:                '10.0.0.10',
        port:              22,
        sshUser:           'root',
        authType:          'PASSWORD',
        passwordEncrypted: null,
        pemKey:            null,
        onePasswordRef:    null,
        bastion:           null,
      }),
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(false),
    }
    const onePassword = {
      resolve: vi.fn(),
    }
    const service = new SftpService(sshRepo as never, onePassword as never)

    await expect(service.list(10, 20, 1, 'USER', '/var/log')).rejects.toBeInstanceOf(ForbiddenError)

    expect(sshRepo.findHostWithCredentials).toHaveBeenCalledWith(10, 1)
    expect(sshRepo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 1, 20, 'connect', 'USER')
    expect(onePassword.resolve).not.toHaveBeenCalled()
  })
})

it.each(['network_generic','cisco_ios','juniper_junos','future_profile'])('blocks direct SFTP for %s before resolving secrets or opening SSH',async(deviceProfile)=>{
  const repo={findHostWithCredentials:vi.fn().mockResolvedValue({id:10,deviceProfile}),hasEffectiveHostPermission:vi.fn().mockResolvedValue(true)}
  const secrets={resolve:vi.fn()}
  await expect(new SftpService(repo as never,secrets as never).list(10,20,1,'USER','/')).rejects.toThrow('SFTP indisponível')
  expect(secrets.resolve).not.toHaveBeenCalled()
})
