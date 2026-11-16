import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Prisma } from '@prisma/client'
import { VaultDatabase, vaultDatabaseUrl } from './vault.database.js'
import { SqlVaultStore } from './vault.repository.js'

describe('isolated vault pool lifecycle',()=>{
  it('preserves datasource options while replacing only pool limits',()=>{
    const source='mysql://fixture:encoded%40password@localhost:3307/vault_test?sslaccept=strict&socket=%2Ftmp%2Ftest.sock&connection_limit=99&connection_limit=88&pool_timeout=30'
    const result=new URL(vaultDatabaseUrl(source)),before=new URL(source)
    expect(result.username).toBe(before.username);expect(result.password).toBe(before.password)
    expect(result.pathname).toBe(before.pathname);expect(result.port).toBe('3307')
    expect(result.searchParams.get('sslaccept')).toBe('strict');expect(result.searchParams.get('socket')).toBe('/tmp/test.sock')
    expect(result.searchParams.getAll('connection_limit')).toEqual(['2']);expect(result.searchParams.getAll('pool_timeout')).toEqual(['1'])
    expect(new URL(source).searchParams.getAll('connection_limit')).toEqual(['99','88'])
  })
  it.each(['not-a-url-private-data','postgres://fixture:private-data@localhost/test'])('sanitizes invalid configuration',source=>{
    try { vaultDatabaseUrl(source);expect.fail('must reject') } catch(e) {
      expect(e).toBeInstanceOf(Error);expect((e as Error).message).toBe('Vault database configuration invalid')
      expect(e).not.toHaveProperty('input');expect(e).not.toHaveProperty('cause')
    }
  })
  it('constructing the container/store does not create a pool; closing unused gateway leaves it untouched',async()=>{
    const create=vi.fn<(options: Prisma.PrismaClientOptions) => PrismaClient>()
    const pool=new VaultDatabase('mysql://fixture:disposable@localhost/test',create)
    const store=new SqlVaultStore(()=>pool.client());expect(store).toBeInstanceOf(SqlVaultStore)
    expect(create).not.toHaveBeenCalled();await pool.close();expect(create).not.toHaveBeenCalled()
    expect(()=>pool.client()).toThrow('Vault database closed')
  })
  it('creates once with logging disabled and disconnects only the owned pool once',async()=>{
    const disconnect=vi.fn().mockResolvedValue(undefined)
    const client={$disconnect:disconnect} as unknown as PrismaClient
    const create=vi.fn().mockReturnValue(client),pool=new VaultDatabase('mysql://fixture:disposable@localhost/test',create)
    expect(pool.client()).toBe(client);expect(pool.client()).toBe(client)
    expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0]?.[0]).toMatchObject({log:[]})
    const first=pool.close();expect(pool.close()).toBe(first);await first
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(()=>pool.client()).toThrow('Vault database closed')
  })
})
