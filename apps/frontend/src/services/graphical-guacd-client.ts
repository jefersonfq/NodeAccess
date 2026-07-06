export interface GuacdInstruction {
  opcode: string
  args: string[]
}

export type GuacdRenderCommand =
  | { type: 'resize'; layer: string; width: number; height: number }
  | { type: 'fillRect'; layer: string; x: number; y: number; width: number; height: number; color: string }
  | { type: 'image'; layer: string; mimeType: string; x: number; y: number; data: string }
  | { type: 'copy'; srcLayer: string; srcX: number; srcY: number; width: number; height: number; dstLayer: string; dstX: number; dstY: number }
  | { type: 'cursor'; hotspotX: number; hotspotY: number; srcLayer: string; srcX: number; srcY: number; width: number; height: number }
  | { type: 'move'; layer: string; parentLayer: string; x: number; y: number; z: number }
  | { type: 'dispose'; layer: string }
  | { type: 'transfer'; srcLayer: string; srcX: number; srcY: number; width: number; height: number; fn: number; dstLayer: string; dstX: number; dstY: number }
  | { type: 'lfill'; layer: string; srcLayer: string; x: number; y: number; width: number; height: number }
  | { type: 'clip'; layer: string; x: number; y: number; width: number; height: number }
  | { type: 'reset'; layer: string }
  | { type: 'shade'; layer: string; opacity: number }

export interface GuacdClipboardText {
  streamIndex: string
  text: string
}

interface ParsedInstruction {
  instruction: GuacdInstruction
  nextOffset: number
}

interface PendingRect {
  layer: string
  x: number
  y: number
  width: number
  height: number
}

interface PendingClipboardStream {
  mimeType: string
  chunks: string[]
}

interface PendingImageStream {
  layer: string
  mimeType: string
  x: number
  y: number
  chunks: string[]
}

export class GuacdInstructionBuffer {
  private buffer = ''

  push(data: string): GuacdInstruction[] {
    this.buffer += data

    const instructions: GuacdInstruction[] = []
    while (this.buffer.length > 0) {
      const parsed = parseFirstInstruction(this.buffer)
      if (!parsed) break
      instructions.push(parsed.instruction)
      this.buffer = this.buffer.slice(parsed.nextOffset)
    }

    return instructions
  }

  reset(): void {
    this.buffer = ''
  }
}

export class GuacdDisplayCommandDecoder {
  private pendingRect: PendingRect | null = null
  private imageStreams = new Map<string, PendingImageStream>()

  decode(instruction: GuacdInstruction): GuacdRenderCommand | null {
    if (instruction.opcode === 'size') {
      return decodeSizeCommand(instruction.args)
    }

    if (instruction.opcode === 'rect') {
      this.pendingRect = decodeRect(instruction.args)
      return null
    }

    if (instruction.opcode === 'cfill') {
      const rect = this.pendingRect
      const color = decodeCfillColor(instruction.args)
      if (!rect || !color) return null
      this.pendingRect = null
      return {
        type: 'fillRect',
        layer: rect.layer,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color,
      }
    }

    if (instruction.opcode === 'png' || instruction.opcode === 'jpeg') {
      return decodeImageCommand(instruction.opcode, instruction.args)
    }

    if (instruction.opcode === 'copy') {
      return decodeCopyCommand(instruction.args)
    }

    if (instruction.opcode === 'cursor') {
      return decodeCursorCommand(instruction.args)
    }

    if (instruction.opcode === 'img') {
      const imageStream = decodeImageStream(instruction.args)
      if (imageStream) this.imageStreams.set(imageStream.streamIndex, imageStream.stream)
      return null
    }

    if (instruction.opcode === 'blob') {
      const [streamIndex, data] = instruction.args
      if (!streamIndex || data === undefined) return null
      const stream = this.imageStreams.get(streamIndex)
      if (!stream) return null
      stream.chunks.push(data)
      return null
    }

    if (instruction.opcode === 'end') {
      const [streamIndex] = instruction.args
      if (!streamIndex) return null
      const stream = this.imageStreams.get(streamIndex)
      this.imageStreams.delete(streamIndex)
      if (!stream) return null
      return {
        type: 'image',
        layer: stream.layer,
        mimeType: stream.mimeType,
        x: stream.x,
        y: stream.y,
        data: stream.chunks.join(''),
      }
    }

    if (instruction.opcode === 'move') {
      return decodeMoveCommand(instruction.args)
    }

    if (instruction.opcode === 'dispose') {
      const [layer] = instruction.args
      if (!layer) return null
      return { type: 'dispose', layer }
    }

    if (instruction.opcode === 'transfer') {
      return decodeTransferCommand(instruction.args)
    }

    if (instruction.opcode === 'lfill') {
      const rect = this.pendingRect
      if (!rect) return null
      const [, , srcLayer] = instruction.args
      if (!srcLayer) return null
      this.pendingRect = null
      return { type: 'lfill', layer: rect.layer, srcLayer, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }

    if (instruction.opcode === 'clip') {
      const [, layer] = instruction.args
      if (!layer) return null
      const rect = this.pendingRect
      return { type: 'clip', layer, x: rect?.x ?? 0, y: rect?.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 }
    }

    if (instruction.opcode === 'reset') {
      const [, layer] = instruction.args
      if (!layer) return null
      return { type: 'reset', layer }
    }

    if (instruction.opcode === 'shade') {
      return decodeShadeCommand(instruction.args)
    }

    return null
  }

  reset(): void {
    this.pendingRect = null
    this.imageStreams.clear()
  }
}

export class GuacdClipboardStreamDecoder {
  private streams = new Map<string, PendingClipboardStream>()

  decode(instruction: GuacdInstruction): GuacdClipboardText | null {
    if (instruction.opcode === 'clipboard') {
      const [streamIndex, mimeType] = instruction.args
      if (!streamIndex || !mimeType) return null
      this.streams.set(streamIndex, { mimeType, chunks: [] })
      return null
    }

    if (instruction.opcode === 'blob') {
      const [streamIndex, data] = instruction.args
      if (!streamIndex || data === undefined) return null
      const stream = this.streams.get(streamIndex)
      if (!stream) return null
      stream.chunks.push(data)
      return null
    }

    if (instruction.opcode === 'end') {
      const [streamIndex] = instruction.args
      if (!streamIndex) return null
      const stream = this.streams.get(streamIndex)
      this.streams.delete(streamIndex)
      if (!stream || !isTextMimeType(stream.mimeType)) return null
      return {
        streamIndex,
        text: decodeBase64Utf8(stream.chunks.join('')),
      }
    }

    return null
  }

  reset(): void {
    this.streams.clear()
  }
}

export function encodeGuacdInstruction(opcode: string, ...args: string[]): string {
  return [opcode, ...args].map(encodeElement).join(',') + ';'
}

export function createGuacdSyncResponse(instruction: GuacdInstruction): string | null {
  if (instruction.opcode !== 'sync') return null
  const timestamp = instruction.args[0]
  return timestamp ? encodeGuacdInstruction('sync', timestamp) : null
}

export function createGuacdAckResponse(instruction: GuacdInstruction): string | null {
  if (instruction.opcode !== 'blob') return null
  const streamIndex = instruction.args[0]
  return streamIndex ? encodeGuacdInstruction('ack', streamIndex, 'OK', '0') : null
}

export function encodeGuacdMouse(x: number, y: number, buttonMask: number): string {
  return encodeGuacdInstruction('mouse', String(Math.round(x)), String(Math.round(y)), String(buttonMask))
}

export function encodeGuacdKey(keysym: number, pressed: boolean): string {
  return encodeGuacdInstruction('key', String(keysym), pressed ? '1' : '0')
}

export function encodeGuacdSize(width: number, height: number, dpi = 96): string {
  return encodeGuacdInstruction('size', String(Math.round(width)), String(Math.round(height)), String(Math.round(dpi)))
}

export interface GuacdDisplayMetrics {
  width: number
  height: number
  dpi: number
  scale: number
}

export function resolveGuacdDisplayMetrics(width: number, height: number, devicePixelRatio = 1): GuacdDisplayMetrics {
  const scale = Math.max(1, Math.min(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1))
  return {
    width: Math.max(320, Math.round(width * scale)),
    height: Math.max(240, Math.round(height * scale)),
    dpi: Math.max(96, Math.min(192, Math.round(96 * scale))),
    scale,
  }
}

export function encodeGuacdClipboardText(text: string, streamIndex: number): string[] {
  const stream = String(streamIndex)
  return [
    encodeGuacdInstruction('clipboard', stream, 'text/plain;charset=utf-8'),
    encodeGuacdInstruction('blob', stream, encodeBase64Utf8(text)),
    encodeGuacdInstruction('end', stream),
  ]
}

export interface GuacdKeyboardLikeEvent {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
}

export function keysymFromKeyboardEvent(event: GuacdKeyboardLikeEvent): number | null {
  const special = SPECIAL_KEYSYMS[event.key]
  if (special !== undefined) return special

  const functionKey = /^F(\d{1,2})$/.exec(event.key)
  if (functionKey) {
    const index = Number(functionKey[1])
    if (index >= 1 && index <= 24) return 0xffbd + index
  }

  if (event.key.length === 1) {
    if (event.ctrlKey || event.metaKey) {
      return event.key.toUpperCase().charCodeAt(0)
    }
    return event.key.codePointAt(0) ?? null
  }

  return null
}

const SPECIAL_KEYSYMS: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Insert: 0xff63,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Shift: 0xffe1,
  Control: 0xffe3,
  Alt: 0xffe9,
  Meta: 0xffeb,
  CapsLock: 0xffe5,
  PrintScreen: 0xff61,
  ScrollLock: 0xff14,
  Pause: 0xff13,
  NumLock: 0xff7f,
}

function decodeSizeCommand(args: string[]): GuacdRenderCommand | null {
  const layer = args.at(-3) ?? '0'
  const width = Number(args.at(-2))
  const height = Number(args.at(-1))
  if (!isPositiveNumber(width) || !isPositiveNumber(height)) return null
  return {
    type: 'resize',
    layer,
    width: Math.round(width),
    height: Math.round(height),
  }
}

function decodeRect(args: string[]): PendingRect | null {
  if (args.length < 6) return null
  const [, layer, xRaw, yRaw, widthRaw, heightRaw] = args
  const x = Number(xRaw)
  const y = Number(yRaw)
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  if (!layer || !isFiniteNumber(x) || !isFiniteNumber(y) || !isPositiveNumber(width) || !isPositiveNumber(height)) {
    return null
  }
  return { layer, x, y, width, height }
}

function decodeCfillColor(args: string[]): string | null {
  if (args.length < 6) return null
  const [,,, rRaw, gRaw, bRaw, aRaw] = args.length >= 7 ? args : ['', ...args]
  const r = Number(rRaw)
  const g = Number(gRaw)
  const b = Number(bRaw)
  const a = Number(aRaw)
  if (![r, g, b, a].every(isFiniteNumber)) return null
  return `rgba(${clampColor(r)}, ${clampColor(g)}, ${clampColor(b)}, ${clampAlpha(a)})`
}

function decodeImageCommand(opcode: 'png' | 'jpeg', args: string[]): GuacdRenderCommand | null {
  const parts = args.length >= 5
    ? { x: args[2], y: args[3], data: args[4] }
    : { x: args[1], y: args[2], data: args[3] }
  const x = Number(parts.x)
  const y = Number(parts.y)
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !parts.data) return null
  return {
    type: 'image',
    layer: args.length >= 5 ? args[1] ?? '0' : '0',
    mimeType: opcode === 'png' ? 'image/png' : 'image/jpeg',
    x,
    y,
    data: parts.data,
  }
}

function decodeImageStream(args: string[]): { streamIndex: string; stream: PendingImageStream } | null {
  if (args.length < 2) return null
  const [streamIndex] = args
  if (!streamIndex) return null

  const mimeType = args.find(isSupportedImageMimeType) ?? 'image/png'
  const mimeIndex = args.findIndex(isSupportedImageMimeType)
  const position = decodeImageStreamPosition(args, mimeIndex)

  return {
    streamIndex,
    stream: {
      layer: position.layer,
      mimeType,
      x: position.x,
      y: position.y,
      chunks: [],
    },
  }
}

function decodeImageStreamPosition(args: string[], mimeIndex: number): { layer: string; x: number; y: number } {
  const values = mimeIndex >= 0 ? args.slice(mimeIndex + 1) : args.slice(1)
  if (values.length >= 4) {
    const [, layer, xRaw, yRaw] = values
    const x = Number(xRaw)
    const y = Number(yRaw)
    if (layer !== undefined && isFiniteNumber(x) && isFiniteNumber(y)) return { layer, x, y }
  }

  if (values.length >= 3) {
    const [layer, xRaw, yRaw] = values
    const x = Number(xRaw)
    const y = Number(yRaw)
    if (layer !== undefined && isFiniteNumber(x) && isFiniteNumber(y)) return { layer, x, y }
  }

  const numericArgs = args
    .map((arg) => Number(arg))
    .filter(isFiniteNumber)
  return {
    layer: '0',
    x: numericArgs.at(-2) ?? 0,
    y: numericArgs.at(-1) ?? 0,
  }
}

function decodeCopyCommand(args: string[]): GuacdRenderCommand | null {
  if (args.length < 9) return null
  const [srcLayer, srcXRaw, srcYRaw, widthRaw, heightRaw, , dstLayer, dstXRaw, dstYRaw] = args

  const srcX = Number(srcXRaw)
  const srcY = Number(srcYRaw)
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  const dstX = Number(dstXRaw)
  const dstY = Number(dstYRaw)
  if (![srcX, srcY, dstX, dstY].every(isFiniteNumber) || !isPositiveNumber(width) || !isPositiveNumber(height)) {
    return null
  }

  return { type: 'copy', srcLayer, srcX, srcY, width, height, dstLayer, dstX, dstY }
}

function decodeCursorCommand(args: string[]): GuacdRenderCommand | null {
  if (args.length < 7) return null
  const [hotspotXRaw, hotspotYRaw, srcLayer, srcXRaw, srcYRaw, widthRaw, heightRaw] = args
  const hotspotX = Number(hotspotXRaw)
  const hotspotY = Number(hotspotYRaw)
  const srcX = Number(srcXRaw)
  const srcY = Number(srcYRaw)
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  if (
    !srcLayer ||
    ![hotspotX, hotspotY, srcX, srcY].every(isFiniteNumber) ||
    !isPositiveNumber(width) ||
    !isPositiveNumber(height)
  ) {
    return null
  }

  return {
    type: 'cursor',
    hotspotX,
    hotspotY,
    srcLayer,
    srcX,
    srcY,
    width,
    height,
  }
}

function decodeMoveCommand(args: string[]): GuacdRenderCommand | null {
  if (args.length < 5) return null
  const [layer, parentLayer, xRaw, yRaw, zRaw] = args
  if (!layer || !parentLayer) return null
  const x = Number(xRaw)
  const y = Number(yRaw)
  const z = Number(zRaw)
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null
  return { type: 'move', layer, parentLayer, x, y, z }
}

function decodeTransferCommand(args: string[]): GuacdRenderCommand | null {
  if (args.length < 9) return null
  const [srcLayer, srcXRaw, srcYRaw, widthRaw, heightRaw, fnRaw, dstLayer, dstXRaw, dstYRaw] = args
  const srcX = Number(srcXRaw)
  const srcY = Number(srcYRaw)
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  const fn = Number(fnRaw)
  const dstX = Number(dstXRaw)
  const dstY = Number(dstYRaw)
  if (![srcX, srcY, dstX, dstY, fn].every(isFiniteNumber) || !isPositiveNumber(width) || !isPositiveNumber(height)) {
    return null
  }
  return { type: 'transfer', srcLayer: srcLayer ?? '0', srcX, srcY, width, height, fn, dstLayer: dstLayer ?? '0', dstX, dstY }
}

function decodeShadeCommand(args: string[]): GuacdRenderCommand | null {
  if (args.length < 2) return null
  const [layer, opacityRaw] = args
  const opacity = Number(opacityRaw)
  if (!layer || !isFiniteNumber(opacity)) return null
  return { type: 'shade', layer, opacity }
}

function isSupportedImageMimeType(value: string): boolean {
  return value.toLowerCase().startsWith('image/')
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function clampAlpha(value: number): number {
  return Math.max(0, Math.min(1, value / 255))
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  if (typeof btoa === 'function') return btoa(binary)
  return Buffer.from(bytes).toString('base64')
}

function decodeBase64Utf8(value: string): string {
  const binary = typeof atob === 'function'
    ? atob(value)
    : Buffer.from(value, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function isTextMimeType(value: string): boolean {
  return value.toLowerCase().startsWith('text/plain')
}

function encodeElement(value: string): string {
  return `${Array.from(value).length}.${value}`
}

function parseFirstInstruction(raw: string): ParsedInstruction | null {
  const elements: string[] = []
  let offset = 0

  while (offset < raw.length) {
    const dotIndex = raw.indexOf('.', offset)
    if (dotIndex === -1) return null

    const length = Number(raw.slice(offset, dotIndex))
    if (!Number.isInteger(length) || length < 0) {
      throw new Error('Invalid Guacamole instruction length')
    }

    const valueStart = dotIndex + 1
    const valueEnd = valueStart + length
    if (raw.length <= valueEnd) return null

    elements.push(raw.slice(valueStart, valueEnd))

    const separator = raw[valueEnd]
    if (separator === ';') {
      const [opcode, ...args] = elements
      if (!opcode) throw new Error('Invalid Guacamole instruction opcode')
      return {
        instruction: { opcode, args },
        nextOffset: valueEnd + 1,
      }
    }

    if (separator !== ',') {
      throw new Error('Invalid Guacamole instruction separator')
    }

    offset = valueEnd + 1
  }

  return null
}
