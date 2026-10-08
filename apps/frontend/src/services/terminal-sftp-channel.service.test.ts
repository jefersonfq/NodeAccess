import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileUtilityViaTerminal, rememberTerminalEdit, subscribeTerminalEdits, terminalEdits, handleTerminalSftpResult, hasTerminalSftpChannel, homeViaTerminalSftp, listViaTerminalSftp, registerTerminalSftpChannel } from './terminal-sftp-channel.service'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); terminalEdits.clear(); vi.useRealTimers() })

describe('terminal SFTP channel', () => {
  it('multiplexes directory requests through the active SSH websocket', async () => {
    const send = vi.fn()
    cleanups.push(registerTerminalSftpChannel(42, send))
    const result = listViaTerminalSftp(42, '/var', undefined, { prefix: 'lo', directoriesOnly: true, limit: 96 })
    const request = JSON.parse(send.mock.calls[0]![0])
    expect(request).toMatchObject({ type: 'sftp_list', path: '/var', prefix: 'lo', directoriesOnly: true, limit: 96 })
    expect(handleTerminalSftpResult(42, { type: 'sftp_result', requestId: request.requestId, ok: true, path: '/var', entries: [{ name: 'log', type: 'directory' }] })).toBe(true)
    await expect(result).resolves.toMatchObject({ path: '/var', entries: [{ name: 'log' }] })
  })

  it('supports home discovery without opening a REST SSH connection', async () => {
    const send = vi.fn()
    cleanups.push(registerTerminalSftpChannel(7, send))
    const result = homeViaTerminalSftp(7)
    const request = JSON.parse(send.mock.calls[0]![0])
    handleTerminalSftpResult(7, { type: 'sftp_result', requestId: request.requestId, ok: true, home: '/home/admin' })
    await expect(result).resolves.toBe('/home/admin')
  })

  it('rejects pending work and removes availability when the SSH session ends', async () => {
    const send = vi.fn()
    const unregister = registerTerminalSftpChannel(9, send)
    const result = listViaTerminalSftp(9, '/')
    expect(hasTerminalSftpChannel(9)).toBe(true)
    unregister()
    expect(hasTerminalSftpChannel(9)).toBe(false)
    await expect(result).rejects.toThrow('Sessão SFTP encerrada')
  })

  it('ignores responses belonging to another terminal session', () => {
    expect(handleTerminalSftpResult(999, { type: 'sftp_result', requestId: 'unknown', ok: true })).toBe(true)
    expect(handleTerminalSftpResult(null, { type: 'sftp_result', requestId: 'unknown', ok: true })).toBe(false)
  })

  it('retries one transient busy response and recovers transparently', async () => {
    vi.useFakeTimers()
    const send = vi.fn((raw: string) => {
      const request = JSON.parse(raw)
      if (send.mock.calls.length === 1) handleTerminalSftpResult(12, { type: 'sftp_result', requestId: request.requestId, ok: false, code: 'SFTP_BUSY' })
      else handleTerminalSftpResult(12, { type: 'sftp_result', requestId: request.requestId, ok: true, entries: [{ name: 'log', type: 'directory' }] })
    })
    cleanups.push(registerTerminalSftpChannel(12, send))
    const result = listViaTerminalSftp(12, '/var')
    await vi.advanceTimersByTimeAsync(75)
    await expect(result).resolves.toMatchObject({ entries: [{ name: 'log' }] })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not retry permanent unavailability', async () => {
    const send = vi.fn((raw: string) => {
      const request = JSON.parse(raw)
      handleTerminalSftpResult(13, { type: 'sftp_result', requestId: request.requestId, ok: false, code: 'SFTP_UNAVAILABLE' })
    })
    cleanups.push(registerTerminalSftpChannel(13, send))
    await expect(listViaTerminalSftp(13, '/')).rejects.toThrow('SFTP_UNAVAILABLE')
    expect(send).toHaveBeenCalledOnce()
  })

  it('keeps requests from a replacement transport when the stale socket cleans up', async () => {
    const oldSend = vi.fn()
    const unregisterOld = registerTerminalSftpChannel(14, oldSend)
    const newSend = vi.fn()
    cleanups.push(registerTerminalSftpChannel(14, newSend))
    const result = listViaTerminalSftp(14, '/')
    const request = JSON.parse(newSend.mock.calls[0]![0])
    unregisterOld()
    handleTerminalSftpResult(14, { type: 'sftp_result', requestId: request.requestId, ok: true, entries: [] })
    await expect(result).resolves.toMatchObject({ entries: [] })
  })

  it('fails immediately when the websocket transport throws synchronously', async () => {
    cleanups.push(registerTerminalSftpChannel(15, () => { throw new Error('socket closed') }))
    await expect(listViaTerminalSftp(15, '/')).rejects.toThrow('socket closed')
  })
  it('never retries file mutations after an ambiguous transient failure', async () => {
    const send = vi.fn((raw: string) => {
      const request = JSON.parse(raw)
      handleTerminalSftpResult(51, { type: 'sftp_result', requestId: request.requestId, ok: false, code: 'SFTP_OPERATION_FAILED' })
    })
    cleanups.push(registerTerminalSftpChannel(51, send))
    await expect(fileUtilityViaTerminal(51, { operation: 'copy', path: '/file', targetSessionId: 52 })).rejects.toThrow('SFTP_OPERATION_FAILED')
    expect(send).toHaveBeenCalledOnce()
  })
  it('notifies an open editor panel immediately when its owning channel closes', () => {
    const stop = registerTerminalSftpChannel(53, vi.fn())
    const notify = vi.fn(); cleanups.push(subscribeTerminalEdits(53, notify))
    rememberTerminalEdit(53, '/config.conf', 'edit')
    stop()
    expect(terminalEdits.get('53:/config.conf')?.state).toBe('offline')
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ path: '/config.conf', state: 'offline' }))
  })
  it('a stale transport cannot mark a replacement editor offline', () => {
    const old = registerTerminalSftpChannel(54, vi.fn())
    cleanups.push(registerTerminalSftpChannel(54, vi.fn()))
    rememberTerminalEdit(54, '/config.conf', 'new-edit')
    old()
    expect(terminalEdits.get('54:/config.conf')?.state).toBe('preparing')
    expect(hasTerminalSftpChannel(54)).toBe(true)
  })

})
