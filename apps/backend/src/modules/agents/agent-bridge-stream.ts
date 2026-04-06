import { Duplex } from 'node:stream'

type WriteCallback = (error?: Error | null) => void

export class AgentBridgeStream extends Duplex {
  private suppressCloseNotification = false
  private closeNotified = false

  constructor(
    private readonly onOutboundData: (chunk: Buffer) => void,
    private readonly onLocalClose?: () => void,
  ) {
    super()
  }

  override _read(): void {
    // O lado remoto empurra dados via pushInbound().
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: WriteCallback,
  ): void {
    try {
      this.onOutboundData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      callback()
    } catch (error) {
      callback(error as Error)
    }
  }

  override _final(callback: WriteCallback): void {
    this.notifyCloseOnce()
    callback()
  }

  override _destroy(error: Error | null, callback: WriteCallback): void {
    this.notifyCloseOnce()
    callback(error)
  }

  pushInbound(chunk: Buffer): void {
    if (!this.destroyed) this.push(chunk)
  }

  remoteClose(): void {
    this.suppressCloseNotification = true
    if (!this.destroyed) {
      this.push(null)
      this.destroy()
    }
  }

  remoteError(message: string): void {
    this.suppressCloseNotification = true
    if (!this.destroyed) {
      this.destroy(new Error(message))
    }
  }

  private notifyCloseOnce(): void {
    if (this.closeNotified || this.suppressCloseNotification) return
    this.closeNotified = true
    this.onLocalClose?.()
  }
}
