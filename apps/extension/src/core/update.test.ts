import { describe, expect, it, vi } from 'vitest'
import { createUpdateCheck } from './update'

const reply = (body: string, status = 200) => vi.fn(() => Promise.resolve(new Response(body, { status })))
describe('NA-0190 local build update check', () => {
  it('offers an update only when the portal announces another valid build id', async () => {
    const other = reply(JSON.stringify({ buildId: 'bbbbbbbbbbbb' }))
    expect(await createUpdateCheck('https://portal.test', 'aaaaaaaaaaaa', other).available()).toBe(true)
    expect(other).toHaveBeenCalledWith('https://portal.test/vaultnaccess-build.json', expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error' }))
    expect(await createUpdateCheck('https://portal.test', 'aaaaaaaaaaaa', reply(JSON.stringify({ buildId: 'aaaaaaaaaaaa' }))).available()).toBe(false)
  })
  it('never asks for test/production builds and ignores anything unexpected', async () => {
    const fetcher = reply('{}')
    expect(await createUpdateCheck('https://portal.test', '', fetcher).available()).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    for (const f of [reply('not json'), reply(JSON.stringify({ buildId: 'XYZ' })), reply(JSON.stringify({ buildId: 7 })), reply('{}', 404),
      reply(`{"buildId":"bbbbbbbbbbbb","pad":"${'x'.repeat(600)}"}`), vi.fn(() => Promise.reject(new Error('offline')))])
      expect(await createUpdateCheck('https://portal.test', 'aaaaaaaaaaaa', f as unknown as typeof fetch).available()).toBe(false)
  })
})
