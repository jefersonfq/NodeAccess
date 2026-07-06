import { describe, expect, it, vi } from 'vitest'
import { Duplex } from 'node:stream'
import { openTelnetSession, TelnetNegotiator } from './telnet.session.js'

const IAC = 255
const DO = 253
const WILL = 251
const SB = 250
const SE = 240
const TERMINAL_TYPE = 24
const NAWS = 31

class FakeTelnetSocket extends Duplex {
  readonly writes: Buffer[] = []

  _read(): void {}

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(Buffer.from(chunk))
    callback()
  }

  serverSend(data: Buffer): void {
    this.emit('data', data)
  }

  serverClose(): void {
    this.emit('close')
  }
}

describe('TelnetNegotiator', () => {
  it('strips telnet commands from terminal output and negotiates NAWS', () => {
    const sent: Buffer[] = []
    const negotiator = new TelnetNegotiator(120, 40, { send: (data) => sent.push(data) })

    const output = negotiator.handleIncoming(Buffer.from([
      ...Buffer.from('login: ', 'utf8'),
      IAC, DO, NAWS,
      ...Buffer.from('user', 'utf8'),
    ]))

    expect(output.toString('utf8')).toBe('login: user')
    expect(sent.map((item) => [...item])).toContainEqual([IAC, WILL, NAWS])
    expect(sent.map((item) => [...item])).toContainEqual([IAC, SB, NAWS, 0, 120, 0, 40, IAC, SE])
  })

  it('keeps partial IAC sequences buffered until complete', () => {
    const sent: Buffer[] = []
    const negotiator = new TelnetNegotiator(80, 24, { send: (data) => sent.push(data) })

    expect(negotiator.handleIncoming(Buffer.from([IAC])).length).toBe(0)
    expect(negotiator.handleIncoming(Buffer.from([DO, NAWS])).length).toBe(0)
    expect(sent.map((item) => [...item])).toContainEqual([IAC, WILL, NAWS])
  })

  it('responds to terminal type SEND subnegotiation', () => {
    const sent: Buffer[] = []
    const negotiator = new TelnetNegotiator(80, 24, { send: (data) => sent.push(data) })

    negotiator.handleIncoming(Buffer.from([IAC, DO, TERMINAL_TYPE]))
    negotiator.handleIncoming(Buffer.from([IAC, SB, TERMINAL_TYPE, 1, IAC, SE]))

    expect(sent.map((item) => [...item])).toContainEqual([IAC, WILL, TERMINAL_TYPE])
    expect(sent.at(-1)?.toString('latin1')).toBe(Buffer.from([
      IAC, SB, TERMINAL_TYPE, 0,
      ...Buffer.from('xterm', 'ascii'),
      IAC, SE,
    ]).toString('latin1'))
  })

  it('does not report remote close when the local session is closed intentionally', async () => {
    const socket = new FakeTelnetSocket()
    const onClose = vi.fn()

    const session = await openTelnetSession({
      host: 'example.test',
      port: 23,
      cols: 80,
      rows: 24,
      sock: socket,
      onData: () => {},
      onClose,
      onError: () => {},
    })

    session.close()
    socket.serverClose()

    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports close when the remote side closes the socket', async () => {
    const socket = new FakeTelnetSocket()
    const onClose = vi.fn()

    await openTelnetSession({
      host: 'example.test',
      port: 23,
      cols: 80,
      rows: 24,
      sock: socket,
      onData: () => {},
      onClose,
      onError: () => {},
    })

    socket.serverClose()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('openTelnetSession', () => {
  it('pipes clean terminal output and user input over an injected socket', async () => {
    const socket = new FakeTelnetSocket()
    const output: Buffer[] = []

    const session = await openTelnetSession({
      host: 'example.test',
      port: 23,
      cols: 100,
      rows: 30,
      sock: socket,
      onData: (data) => output.push(data),
      onClose: () => {},
      onError: () => {},
    })

    socket.serverSend(Buffer.from([
      ...Buffer.from('login: ', 'utf8'),
      IAC, DO, NAWS,
      ...Buffer.from('user', 'utf8'),
    ]))
    session.write(Buffer.from('admin\r', 'utf8'))

    expect(output.map((item) => item.toString('utf8')).join('')).toBe('login: user')
    expect(socket.writes.map((item) => [...item])).toContainEqual([IAC, WILL, NAWS])
    expect(socket.writes.map((item) => item.toString('utf8'))).toContain('admin\r')
  })
})
