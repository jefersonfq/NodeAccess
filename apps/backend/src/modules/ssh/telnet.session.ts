import net from 'node:net'
import type { Duplex } from 'node:stream'

const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240

const OPT_ECHO = 1
const OPT_SUPPRESS_GO_AHEAD = 3
const OPT_TERMINAL_TYPE = 24
const OPT_NAWS = 31

const TERMINAL_TYPE_IS = 0
const TERMINAL_TYPE_SEND = 1

interface TelnetNegotiationHandlers {
  send: (data: Buffer) => void
}

export interface TelnetSessionHandle {
  write(data: Buffer): void
  resize(cols: number, rows: number): void
  close(): void
}

export interface OpenTelnetSessionInput {
  host: string
  port: number
  cols: number
  rows: number
  sock?: Duplex
  onData: (data: Buffer) => void
  onClose: () => void
  onError: (error: Error) => void
}

export type TelnetSessionOpener = (input: OpenTelnetSessionInput) => Promise<TelnetSessionHandle>

export class TelnetNegotiator {
  private buffer = Buffer.alloc(0)
  private cols: number
  private rows: number
  private nawsAccepted = false
  private terminalTypeAccepted = false

  constructor(cols: number, rows: number, private readonly handlers: TelnetNegotiationHandlers) {
    this.cols = normalizeDimension(cols, 80)
    this.rows = normalizeDimension(rows, 24)
  }

  handleIncoming(chunk: Buffer): Buffer {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const output: number[] = []
    let i = 0

    while (i < this.buffer.length) {
      const byte = this.buffer[i] ?? 0
      if (byte !== IAC) {
        output.push(byte)
        i += 1
        continue
      }

      if (i + 1 >= this.buffer.length) break
      const command = this.buffer[i + 1] ?? 0

      if (command === IAC) {
        output.push(IAC)
        i += 2
        continue
      }

      if (command === DO || command === DONT || command === WILL || command === WONT) {
        if (i + 2 >= this.buffer.length) break
        this.respond(command, this.buffer[i + 2] ?? 0)
        i += 3
        continue
      }

      if (command === SB) {
        const end = this.findSubnegotiationEnd(i + 2)
        if (end === -1) break
        this.handleSubnegotiation(this.buffer.subarray(i + 2, end))
        i = end + 2
        continue
      }

      i += 2
    }

    this.buffer = this.buffer.subarray(i)
    return Buffer.from(output)
  }

  resize(cols: number, rows: number): void {
    this.cols = normalizeDimension(cols, this.cols)
    this.rows = normalizeDimension(rows, this.rows)
    if (this.nawsAccepted) this.sendNaws()
  }

  private respond(command: number, option: number): void {
    if (command === DO) {
      if (option === OPT_NAWS) {
        this.nawsAccepted = true
        this.sendCommand(WILL, option)
        this.sendNaws()
        return
      }
      if (option === OPT_TERMINAL_TYPE) {
        this.terminalTypeAccepted = true
        this.sendCommand(WILL, option)
        return
      }
      if (option === OPT_SUPPRESS_GO_AHEAD) {
        this.sendCommand(WILL, option)
        return
      }
      this.sendCommand(WONT, option)
      return
    }

    if (command === WILL) {
      if (option === OPT_ECHO || option === OPT_SUPPRESS_GO_AHEAD) {
        this.sendCommand(DO, option)
        return
      }
      this.sendCommand(DONT, option)
      return
    }

    if (command === DONT && option === OPT_NAWS) {
      this.nawsAccepted = false
    }
    if (command === DONT && option === OPT_TERMINAL_TYPE) {
      this.terminalTypeAccepted = false
    }
  }

  private handleSubnegotiation(payload: Buffer): void {
    if (!this.terminalTypeAccepted) return
    if (payload[0] === OPT_TERMINAL_TYPE && payload[1] === TERMINAL_TYPE_SEND) {
      this.handlers.send(Buffer.from([
        IAC, SB, OPT_TERMINAL_TYPE, TERMINAL_TYPE_IS,
        ...Buffer.from('xterm', 'ascii'),
        IAC, SE,
      ]))
    }
  }

  private findSubnegotiationEnd(start: number): number {
    for (let i = start; i < this.buffer.length - 1; i += 1) {
      if (this.buffer[i] === IAC && this.buffer[i + 1] === SE) return i
    }
    return -1
  }

  private sendCommand(command: number, option: number): void {
    this.handlers.send(Buffer.from([IAC, command, option]))
  }

  private sendNaws(): void {
    this.handlers.send(Buffer.from([
      IAC, SB, OPT_NAWS,
      (this.cols >> 8) & 0xff,
      this.cols & 0xff,
      (this.rows >> 8) & 0xff,
      this.rows & 0xff,
      IAC, SE,
    ]))
  }
}

export async function openTelnetSession(input: OpenTelnetSessionInput): Promise<TelnetSessionHandle> {
  const socket = input.sock ?? net.createConnection({ host: input.host, port: input.port })
  let locallyClosed = false
  const negotiator = new TelnetNegotiator(input.cols, input.rows, {
    send: (data) => {
      if (!socket.destroyed) socket.write(data)
    },
  })

  await new Promise<void>((resolve, reject) => {
    if (input.sock) {
      queueMicrotask(resolve)
      return
    }

    const onConnect = () => {
      cleanup()
      negotiator.resize(input.cols, input.rows)
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      socket.off('connect', onConnect)
      socket.off('error', onError)
    }

    socket.once('connect', onConnect)
    socket.once('error', onError)
  })

  socket.on('data', (chunk: Buffer) => {
    const clean = negotiator.handleIncoming(chunk)
    if (clean.length > 0) input.onData(clean)
  })
  socket.on('error', input.onError)
  socket.on('close', () => {
    if (!locallyClosed) input.onClose()
  })

  return {
    write(data: Buffer) {
      if (!socket.destroyed) socket.write(data)
    },
    resize(cols: number, rows: number) {
      negotiator.resize(cols, rows)
    },
    close() {
      locallyClosed = true
      socket.destroy()
    },
  }
}

function normalizeDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(65535, Math.floor(value)))
}
