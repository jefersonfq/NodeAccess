import childProcess from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateTrialPrivateKey } from './trial-pem-validation.js'

const nativeSpawn = childProcess.spawn.bind(childProcess)
afterEach(() => vi.restoreAllMocks())
describe('isolated and bounded trial PEM validation', () => {
  it('accepts private PEM, validates encrypted PEM passphrases and rejects malformed/public-only data', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
    await expect(validateTrialPrivateKey(pair.privateKey)).resolves.toBeUndefined()
    const encrypted = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'synthetic-fixture-passphrase' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
    await expect(validateTrialPrivateKey(encrypted.privateKey,'synthetic-fixture-passphrase')).resolves.toBeUndefined()
    await expect(validateTrialPrivateKey(encrypted.privateKey,'wrong-fixture')).rejects.toMatchObject({ statusCode: 422 })
    await expect(validateTrialPrivateKey(pair.publicKey)).rejects.toMatchObject({ statusCode: 422 })
    await expect(validateTrialPrivateKey('malformed')).rejects.toMatchObject({ statusCode: 422 })
  })
  it('kills CPU-bound parsers at two seconds, limits concurrency and keeps key material off argv/env', async () => {
    const spawned: ReturnType<typeof nativeSpawn>[] = []
    const spy = vi.spyOn(childProcess,'spawn').mockImplementation((...args: Parameters<typeof childProcess.spawn>) => {
      const process = nativeSpawn(args[0], ['-e','process.stdin.resume();process.stdin.on("end",()=>{while(true){}})'], args[2])
      spawned.push(process)
      return process
    })
    const first = validateTrialPrivateKey('synthetic-secret-one','fixture-one')
    const second = validateTrialPrivateKey('synthetic-secret-two','fixture-two')
    // Observe both rejections immediately so the timeout cannot create an unhandled rejection.
    const results = Promise.allSettled([first,second])
    await expect(validateTrialPrivateKey('third')).rejects.toMatchObject({ statusCode: 503, code: 'TRIAL_PEM_VALIDATION_BUSY' })
    await delay(30)
    expect(spawned).toHaveLength(2)
    for (const args of spy.mock.calls) {
      expect(JSON.stringify(args)).not.toContain('synthetic-secret')
      expect(JSON.stringify(args)).not.toContain('fixture-one')
      expect(args[2]).toMatchObject({ env: { NODE_ENV: 'production' } })
    }
    for (const result of await results) expect(result).toMatchObject({ status: 'rejected', reason: { code: 'TRIAL_PEM_VALIDATION_TIMEOUT' } })
    for (const process of spawned) expect(process.signalCode).toBe('SIGKILL')
    spy.mockRestore()
    // Worker slots must be released even when native/CPU work is forcibly killed.
    await expect(validateTrialPrivateKey('invalid-after-timeout')).rejects.toMatchObject({ statusCode: 422 })
  }, 6000)
  it('rejects more than 64KiB before spawning', async () => {
    const spy=vi.spyOn(childProcess,'spawn')
    await expect(validateTrialPrivateKey('a'.repeat(65537))).rejects.toMatchObject({ statusCode: 422 })
    expect(spy).not.toHaveBeenCalled()
  })
})
