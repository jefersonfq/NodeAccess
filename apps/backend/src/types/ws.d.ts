declare module 'ws' {
  import { EventEmitter } from 'node:events'
  import type { AddressInfo } from 'node:net'
  export type RawData = Buffer | ArrayBuffer | Buffer[]
  export class WebSocket extends EventEmitter {
    constructor(address: string | URL, options?: Record<string, unknown>)
    readonly OPEN: 1
    readonly CLOSED: 3
    readyState: number
    readonly bufferedAmount: number
    terminate(): void
    pause(): void
    resume(): void
    send(data: unknown, callback?: (error?: Error) => void): void
    close(code?: number, reason?: string | Buffer): void
    on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
    once(event: 'close', listener: (code: number, reason: Buffer) => void): this
    once(event: 'error', listener: (error: Error) => void): this
    once(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this
    once(event: string, listener: (...args: unknown[]) => void): this
  }
  export class WebSocketServer extends EventEmitter {
    constructor(options: { port?: number; host?: string; noServer?: boolean })
    address(): AddressInfo | string | null
    close(callback?: (error?: Error) => void): void
    on(event: 'connection', listener: (socket: WebSocket) => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
  }
  export default WebSocket
}
