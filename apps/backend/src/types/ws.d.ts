declare module 'ws' {
  export interface WebSocket {
    readyState: number
    readonly bufferedAmount: number
    terminate(): void
    send(data: unknown): void
    close(code?: number, reason?: string | Buffer): void
    on(event: 'message', listener: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): this
    on(event: 'close' | 'error', listener: (...args: unknown[]) => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
    once(event: string, listener: (...args: unknown[]) => void): this
    off(event: string, listener: (...args: unknown[]) => void): this
    removeListener(event: string, listener: (...args: unknown[]) => void): this
  }
}
