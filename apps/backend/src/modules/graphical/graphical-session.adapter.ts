import net from 'node:net'
import type { Duplex } from 'node:stream'
import type { HostCredentials } from '../ssh/ssh.repository.js'
import { decrypt, type EncryptedPayload } from '../../shared/crypto.js'
import { logger } from '../../config/logger.js'

export type GraphicalAccessProtocol = 'rdp' | 'vnc'
export type GraphicalConnectionMethod = 'rdp_gateway_pending' | 'vnc_gateway_pending'

export interface GraphicalSessionAdapterInput {
  sessionId: number
  tenantId: number
  userId: number
  host: HostCredentials
  protocol: GraphicalAccessProtocol
  connectionMethod: GraphicalConnectionMethod
  clientIp?: string
  userAgent?: string
  initialWidth?: number
  initialHeight?: number
  initialDpi?: number
  rdpCredentials?: {
    username: string
    password: string
    domain?: string
  }
}

export interface GraphicalSessionPendingResult {
  status: 'pending'
  code: 'GRAPHICAL_GATEWAY_PENDING'
  message: string
}

export interface GraphicalSessionTransport {
  write(data: string): void
  close(): void
  onData(handler: (data: Buffer) => void): void
  onClose(handler: () => void): void
  onError(handler: (err: Error) => void): void
}

export interface GraphicalSessionConnectedResult {
  status: 'connected'
  code: 'GRAPHICAL_GATEWAY_CONNECTED'
  message: string
  transport: GraphicalSessionTransport
}

export type GraphicalSessionAdapterResult = GraphicalSessionPendingResult | GraphicalSessionConnectedResult

export interface GraphicalSessionAdapter {
  open(input: GraphicalSessionAdapterInput): Promise<GraphicalSessionAdapterResult>
}

export function graphicalConnectionMethod(protocol: GraphicalAccessProtocol): GraphicalConnectionMethod {
  return protocol === 'rdp' ? 'rdp_gateway_pending' : 'vnc_gateway_pending'
}

export class PendingGraphicalSessionAdapter implements GraphicalSessionAdapter {
  async open(_input: GraphicalSessionAdapterInput): Promise<GraphicalSessionAdapterResult> {
    return {
      status: 'pending',
      code: 'GRAPHICAL_GATEWAY_PENDING',
      message: 'Gateway gráfico em preparação',
    }
  }
}

export interface GuacdGraphicalSessionAdapterConfig {
  host: string
  port: number
  connectTimeoutMs?: number
  imageMimeTypes?: string[]
  enableAudioStreams?: boolean
  enableVideoStreams?: boolean
  rdpDefaults?: GuacdRdpDefaults
  vncDefaults?: GuacdVncDefaults
  width?: number
  height?: number
  dpi?: number
  createSocket?: () => Duplex
}

export interface GuacdRdpDefaults {
  ignoreCert?: boolean
  security?: 'any' | 'nla' | 'nla-ext' | 'tls' | 'vmconnect' | 'rdp'
  resizeMethod?: 'display-update' | 'reconnect'
  colorDepth?: 8 | 16 | 24
  forceLossless?: boolean
  enableWallpaper?: boolean
  enableTheming?: boolean
  enableFontSmoothing?: boolean
  enableFullWindowDrag?: boolean
  enableDesktopComposition?: boolean
  enableMenuAnimations?: boolean
  serverLayout?: string
  readOnly?: boolean
  disableGfx?: boolean
  disableBitmapCaching?: boolean
  disableOffscreenCaching?: boolean
}

export interface GuacdVncDefaults {
  colorDepth?: 8 | 16 | 24 | 32
  readOnly?: boolean
  swapRedBlue?: boolean
  cursor?: string
}

export class GuacdGraphicalSessionAdapter implements GraphicalSessionAdapter {
  constructor(private readonly config: GuacdGraphicalSessionAdapterConfig) {}

  async open(input: GraphicalSessionAdapterInput): Promise<GraphicalSessionAdapterResult> {
    const hasStoredUsername = Boolean(input.host.sshUser?.trim())
    const hasStoredPassword = Boolean(input.host.passwordEncrypted)
    const hasInteractiveCredentials = Boolean(input.rdpCredentials?.username.trim() && input.rdpCredentials.password)
    logger.info({
      event: 'graphical.guacd.open.start',
      sessionId: input.sessionId,
      hostId: input.host.id,
      tenantId: input.tenantId,
      userId: input.userId,
      protocol: input.protocol,
      guacdHost: this.config.host,
      guacdPort: this.config.port,
      connectTimeoutMs: this.config.connectTimeoutMs ?? 10_000,
      remoteHost: input.host.ip,
      remotePort: input.host.port,
      initialWidth: input.initialWidth ?? this.config.width ?? 1280,
      initialHeight: input.initialHeight ?? this.config.height ?? 720,
      initialDpi: input.initialDpi ?? this.config.dpi ?? 96,
      hasStoredUsername,
      hasStoredPassword,
      hasInteractiveCredentials,
      imageMimeTypes: normalizedImageMimeTypes(this.config.imageMimeTypes),
	      enableAudioStreams: Boolean(this.config.enableAudioStreams),
	      enableVideoStreams: Boolean(this.config.enableVideoStreams),
	      rdpDefaults: sanitizeRdpDefaults(this.config.rdpDefaults),
	      vncDefaults: sanitizeVncDefaults(this.config.vncDefaults),
	    }, 'opening guacd graphical session')

    const socket = this.config.createSocket?.() ?? net.createConnection({
      host: this.config.host,
      port: this.config.port,
    })

    try {
      await waitForSocketConnect(socket, this.config.connectTimeoutMs ?? 10_000)
      logger.info({
        event: 'graphical.guacd.socket.connected',
        sessionId: input.sessionId,
        hostId: input.host.id,
        protocol: input.protocol,
        guacdHost: this.config.host,
        guacdPort: this.config.port,
        localAddress: (socket as net.Socket).localAddress,
        localPort: (socket as net.Socket).localPort,
        remoteAddress: (socket as net.Socket).remoteAddress,
        remotePort: (socket as net.Socket).remotePort,
      }, 'connected to guacd socket')
      const initialData = await this.handshake(socket, input)
      logger.info({
        event: 'graphical.guacd.open.ready',
        sessionId: input.sessionId,
        hostId: input.host.id,
        protocol: input.protocol,
        initialDataBytes: Buffer.byteLength(initialData),
        initialDataOpcode: parseGuacdOpcode(initialData),
      }, 'guacd graphical session ready')
      return {
        status: 'connected',
        code: 'GRAPHICAL_GATEWAY_CONNECTED',
        message: 'Gateway gráfico conectado',
        transport: new SocketGraphicalSessionTransport(socket, initialData),
      }
    } catch (err) {
      logger.warn({
        event: 'graphical.guacd.open.failed',
        sessionId: input.sessionId,
        hostId: input.host.id,
        protocol: input.protocol,
        ...serializeError(err),
      }, 'failed to open guacd graphical session')
      socket.destroy()
      throw err
    }
  }

  private async handshake(socket: Duplex, input: GraphicalSessionAdapterInput): Promise<string> {
    logger.info({
      event: 'graphical.guacd.handshake.select.send',
      sessionId: input.sessionId,
      hostId: input.host.id,
      protocol: input.protocol,
    }, 'sending guacd select instruction')
    writeInstruction(socket, 'select', input.protocol)

    const argsInstruction = await readInstruction(socket, this.config.connectTimeoutMs ?? 10_000)
    if (argsInstruction.opcode !== 'args') {
      throw new Error(`Resposta inesperada do guacd: ${argsInstruction.opcode}`)
    }
    logger.info({
      event: 'graphical.guacd.handshake.args',
      sessionId: input.sessionId,
      hostId: input.host.id,
      protocol: input.protocol,
      argCount: argsInstruction.args.length,
      args: argsInstruction.args,
      hasPasswordArg: argsInstruction.args.includes('password'),
      hasUsernameArg: argsInstruction.args.includes('username'),
      hasResizeMethodArg: argsInstruction.args.includes('resize-method'),
      hasDisableGfxArg: argsInstruction.args.includes('disable-gfx'),
      trailingBytes: Buffer.byteLength(argsInstruction.rest),
    }, 'received guacd args')

    const width = String(input.initialWidth ?? this.config.width ?? 1280)
    const height = String(input.initialHeight ?? this.config.height ?? 720)
    const dpi = String(input.initialDpi ?? this.config.dpi ?? 96)

    logger.info({
      event: 'graphical.guacd.handshake.size.send',
      sessionId: input.sessionId,
      hostId: input.host.id,
      protocol: input.protocol,
      width,
      height,
      dpi,
    }, 'sending guacd size instruction')
    writeInstruction(socket, 'size', width, height, dpi)
    // Guacamole expects the capability instructions in the full handshake even
    // when no audio/video MIME types are advertised. Omitting these can leave
    // RDP connected without initial display frames from guacd.
    logger.info({
      event: 'graphical.guacd.handshake.audio.send',
      sessionId: input.sessionId,
      hostId: input.host.id,
      protocol: input.protocol,
      enabled: this.config.enableAudioStreams,
    }, 'sending guacd audio instruction')
    writeInstruction(socket, 'audio')

    logger.info({
      event: 'graphical.guacd.handshake.video.send',
      sessionId: input.sessionId,
      hostId: input.host.id,
      protocol: input.protocol,
      enabled: this.config.enableVideoStreams,
    }, 'sending guacd video instruction')
    writeInstruction(socket, 'video')
    const imageMimeTypes = normalizedImageMimeTypes(this.config.imageMimeTypes)
    logger.info({
      event: 'graphical.guacd.handshake.image.send',
      sessionId: input.sessionId,
      hostId: input.host.id,
      protocol: input.protocol,
      imageMimeTypes,
    }, 'sending guacd image instruction')
    writeInstruction(socket, 'image', ...imageMimeTypes)
    const connectArgs = buildConnectArgs(argsInstruction.args, input, width, height, dpi, this.config.rdpDefaults, this.config.vncDefaults)
    logger.info({
      event: 'graphical.guacd.handshake.connect.send',
      sessionId: input.sessionId,
      hostId: input.host.id,
      protocol: input.protocol,
      connectArgCount: connectArgs.length,
      connectArgs: sanitizeConnectArgs(argsInstruction.args, connectArgs),
    }, 'sending guacd connect instruction')
    writeInstruction(socket, 'connect', ...connectArgs)

    const readyInstruction = await readInstruction(socket, this.config.connectTimeoutMs ?? 10_000)
    if (readyInstruction.opcode === 'error') {
      logger.warn({
        event: 'graphical.guacd.handshake.error',
        sessionId: input.sessionId,
        hostId: input.host.id,
        protocol: input.protocol,
        args: readyInstruction.args,
        trailingBytes: Buffer.byteLength(readyInstruction.rest),
      }, 'guacd returned error during handshake')
    }
    if (readyInstruction.opcode !== 'ready') {
      throw new Error(`Handshake guacd não retornou ready: ${readyInstruction.opcode}`)
    }
    logger.info({
      event: 'graphical.guacd.handshake.ready',
      sessionId: input.sessionId,
      hostId: input.host.id,
      protocol: input.protocol,
      readyBytes: Buffer.byteLength(readyInstruction.rest),
      nextOpcode: parseGuacdOpcode(readyInstruction.rest),
    }, 'received guacd ready')
    return readyInstruction.rest
  }
}

class SocketGraphicalSessionTransport implements GraphicalSessionTransport {
  private initialData: Buffer | null

  constructor(
    private readonly socket: Duplex,
    initialData = '',
  ) {
    this.initialData = initialData ? Buffer.from(initialData) : null
  }

  write(data: string): void {
    this.socket.write(data)
  }

  close(): void {
    this.socket.destroy()
  }

  onData(handler: (data: Buffer) => void): void {
    if (this.initialData) {
      const data = this.initialData
      this.initialData = null
      queueMicrotask(() => handler(data))
    }
    this.socket.on('data', (chunk: Buffer | string) => {
      handler(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
  }

  onClose(handler: () => void): void {
    this.socket.once('close', handler)
  }

  onError(handler: (err: Error) => void): void {
    this.socket.once('error', handler)
  }
}

interface GuacamoleInstruction {
  opcode: string
  args: string[]
  rest: string
}

function buildConnectArgs(
  argNames: string[],
  input: GraphicalSessionAdapterInput,
  width: string,
  height: string,
  dpi: string,
  rdpDefaults: GuacdRdpDefaults = {},
  vncDefaults: GuacdVncDefaults = {},
): string[] {
  const username = input.protocol === 'rdp'
    ? input.rdpCredentials?.username.trim() || input.host.sshUser
    : ''
  const password = input.rdpCredentials?.password ?? decryptPassword(input.host.passwordEncrypted)
  const domain = input.rdpCredentials?.domain?.trim() ?? ''
  if (input.protocol === 'vnc') {
    const values = buildVncConnectValueMap(input, password, width, height, dpi, vncDefaults)
    return argNames.map((name) => values[name] ?? '')
  }
  const values = buildRdpConnectValueMap(input, username, password, domain, width, height, dpi, rdpDefaults)
  return argNames.map((name) => values[name] ?? '')
}

function buildRdpConnectValueMap(
  input: GraphicalSessionAdapterInput,
  username: string,
  password: string,
  domain: string,
  width: string,
  height: string,
  dpi: string,
  rdpDefaults: GuacdRdpDefaults,
): Record<string, string> {
  const security = rdpDefaults.security ?? 'any'
  return {
    VERSION_1_5_0: 'VERSION_1_5_0',
    hostname: input.host.ip,
    port: String(input.host.port),
    username,
    password,
    domain,
    width,
    height,
    dpi,
    'ignore-cert': boolParam(rdpDefaults.ignoreCert ?? true),
    security,
    'disable-auth': 'false',
    'resize-method': rdpDefaults.resizeMethod ?? 'display-update',
    'color-depth': String(rdpDefaults.colorDepth ?? 24),
    'force-lossless': boolParam(rdpDefaults.forceLossless ?? true),
    'enable-wallpaper': boolParam(rdpDefaults.enableWallpaper ?? false),
    'enable-theming': boolParam(rdpDefaults.enableTheming ?? false),
    'enable-font-smoothing': boolParam(rdpDefaults.enableFontSmoothing ?? true),
    'enable-full-window-drag': boolParam(rdpDefaults.enableFullWindowDrag ?? false),
    'enable-desktop-composition': boolParam(rdpDefaults.enableDesktopComposition ?? false),
    'enable-menu-animations': boolParam(rdpDefaults.enableMenuAnimations ?? false),
    'server-layout': rdpDefaults.serverLayout ?? 'pt-br-qwerty',
    'read-only': boolParam(rdpDefaults.readOnly ?? false),
    'disable-gfx': boolParam(rdpDefaults.disableGfx ?? true),
    'disable-bitmap-caching': boolParam(rdpDefaults.disableBitmapCaching ?? true),
    'disable-offscreen-caching': boolParam(rdpDefaults.disableOffscreenCaching ?? true),
  }
}

function buildVncConnectValueMap(
  input: GraphicalSessionAdapterInput,
  password: string,
  width: string,
  height: string,
  dpi: string,
  vncDefaults: GuacdVncDefaults,
): Record<string, string> {
  return {
    VERSION_1_5_0: 'VERSION_1_5_0',
    hostname: input.host.ip,
    port: String(input.host.port),
    password,
    width,
    height,
    dpi,
    'color-depth': String(vncDefaults.colorDepth ?? 24),
    'read-only': boolParam(vncDefaults.readOnly ?? false),
    'swap-red-blue': boolParam(vncDefaults.swapRedBlue ?? false),
    cursor: vncDefaults.cursor ?? 'remote',
  }
}

function sanitizeConnectArgs(argNames: string[], values: string[]): Record<string, string | boolean | number | null> {
  const diagnostics: Record<string, string | boolean | number | null> = {}
  for (const [index, name] of argNames.entries()) {
    const value = values[index] ?? ''
    if (name === 'password') {
      diagnostics[name] = value ? '[REDACTED]' : ''
      diagnostics.hasPassword = Boolean(value)
      continue
    }
    if (name === 'username') {
      diagnostics.hasUsername = Boolean(value.trim())
      diagnostics.usernameLength = value.length
      continue
    }
    diagnostics[name] = value
  }
  return diagnostics
}

function sanitizeRdpDefaults(value: GuacdRdpDefaults = {}): Record<string, unknown> {
  return {
    ignoreCert: value.ignoreCert,
    security: value.security,
    resizeMethod: value.resizeMethod,
    colorDepth: value.colorDepth,
    forceLossless: value.forceLossless,
    enableWallpaper: value.enableWallpaper,
    enableTheming: value.enableTheming,
    enableFontSmoothing: value.enableFontSmoothing,
    enableFullWindowDrag: value.enableFullWindowDrag,
    enableDesktopComposition: value.enableDesktopComposition,
    enableMenuAnimations: value.enableMenuAnimations,
    serverLayout: value.serverLayout,
    readOnly: value.readOnly,
    disableGfx: value.disableGfx,
    disableBitmapCaching: value.disableBitmapCaching,
    disableOffscreenCaching: value.disableOffscreenCaching,
  }
}

function sanitizeVncDefaults(value: GuacdVncDefaults = {}): Record<string, unknown> {
  return {
    colorDepth: value.colorDepth,
    readOnly: value.readOnly,
    swapRedBlue: value.swapRedBlue,
    cursor: value.cursor,
  }
}

function normalizedImageMimeTypes(values?: string[]): string[] {
  const normalized = (values?.length ? values : ['image/png', 'image/jpeg'])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.startsWith('image/'))
  return [...new Set(normalized)].length ? [...new Set(normalized)] : ['image/png', 'image/jpeg']
}

function boolParam(value: boolean): string {
  return value ? 'true' : 'false'
}

function decryptPassword(passwordEncrypted: string | null): string {
  if (!passwordEncrypted) return ''
  const payload = JSON.parse(passwordEncrypted) as EncryptedPayload
  return decrypt(payload)
}

function writeInstruction(socket: Duplex, opcode: string, ...args: string[]): void {
  socket.write(encodeInstruction(opcode, ...args))
}

function encodeInstruction(opcode: string, ...args: string[]): string {
  return [opcode, ...args].map(encodeElement).join(',') + ';'
}

function encodeElement(value: string): string {
  return `${Array.from(value).length}.${value}`
}

function waitForSocketConnect(socket: Duplex, timeoutMs: number): Promise<void> {
  if ((socket as net.Socket).readyState === 'open') return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      const err = new Error('Timeout ao conectar no guacd')
      logger.warn({
        event: 'graphical.guacd.socket.timeout',
        timeoutMs,
        readyState: (socket as net.Socket).readyState,
      }, 'timeout while connecting to guacd socket')
      reject(err)
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('connect', onConnect)
      socket.off('error', onError)
    }
    const onConnect = () => {
      cleanup()
      resolve()
    }
    const onError = (err: Error) => {
      cleanup()
      logger.warn({
        event: 'graphical.guacd.socket.error',
        ...serializeError(err),
      }, 'guacd socket error before connect')
      reject(err)
    }
    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

function readInstruction(socket: Duplex, timeoutMs: number): Promise<GuacamoleInstruction> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      cleanup()
      logger.warn({
        event: 'graphical.guacd.instruction.timeout',
        timeoutMs,
        bufferedBytes: Buffer.byteLength(buffer),
        bufferedOpcode: parseGuacdOpcode(buffer),
      }, 'timeout while waiting for guacd instruction')
      reject(new Error('Timeout aguardando resposta do guacd'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString()
      logger.debug({
        event: 'graphical.guacd.instruction.chunk',
        chunkBytes: Buffer.byteLength(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        bufferedBytes: Buffer.byteLength(buffer),
        bufferedOpcode: parseGuacdOpcode(buffer),
      }, 'received guacd instruction chunk during handshake')
      try {
        const parsed = parseInstruction(buffer)
        if (!parsed) return
        cleanup()
        logger.debug({
          event: 'graphical.guacd.instruction.parsed',
          opcode: parsed.opcode,
          argCount: parsed.args.length,
          trailingBytes: Buffer.byteLength(parsed.rest),
        }, 'parsed guacd instruction during handshake')
        resolve(parsed)
      } catch (err) {
        cleanup()
        logger.warn({
          event: 'graphical.guacd.instruction.invalid',
          bufferedBytes: Buffer.byteLength(buffer),
          bufferedPrefix: buffer.slice(0, 160),
          ...serializeError(err),
        }, 'invalid guacd instruction during handshake')
        reject(err)
      }
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    const onClose = () => {
      cleanup()
      logger.warn({
        event: 'graphical.guacd.socket.closed_during_handshake',
        bufferedBytes: Buffer.byteLength(buffer),
        bufferedOpcode: parseGuacdOpcode(buffer),
      }, 'guacd socket closed during handshake')
      reject(new Error('Conexão com guacd encerrada durante handshake'))
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

function parseInstruction(raw: string): GuacamoleInstruction | null {
  const elements: string[] = []
  let offset = 0

  while (offset < raw.length) {
    const dotIndex = raw.indexOf('.', offset)
    if (dotIndex === -1) return null

    const length = Number(raw.slice(offset, dotIndex))
    if (!Number.isInteger(length) || length < 0) {
      throw new Error('Instrução inválida recebida do guacd')
    }

    const valueStart = dotIndex + 1
    const valueEnd = valueStart + length
    if (raw.length <= valueEnd) return null

    elements.push(raw.slice(valueStart, valueEnd))

    const separator = raw[valueEnd]
    if (separator === ';') {
      const [opcode, ...args] = elements
      if (!opcode) throw new Error('Instrução sem opcode recebida do guacd')
      return { opcode, args, rest: raw.slice(valueEnd + 1) }
    }
    if (separator !== ',') {
      throw new Error('Separador inválido recebido do guacd')
    }
    offset = valueEnd + 1
  }

  return null
}

function parseGuacdOpcode(data: string): string | null {
  const dotIndex = data.indexOf('.')
  if (dotIndex === -1) return null
  const length = Number(data.slice(0, dotIndex))
  if (!Number.isInteger(length) || length <= 0) return null
  return data.slice(dotIndex + 1, dotIndex + 1 + length) || null
}

function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { errorMessage: String(err) }
  const nodeErr = err as NodeJS.ErrnoException
  const networkErr = err as NodeJS.ErrnoException & { address?: string; port?: number }
  return {
    errorName: err.name,
    errorMessage: err.message,
    errorCode: nodeErr.code,
    errorSyscall: nodeErr.syscall,
    errorAddress: networkErr.address,
    errorPort: networkErr.port,
    errorStack: err.stack,
  }
}
