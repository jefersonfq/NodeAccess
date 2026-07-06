<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NPopconfirm,
  NSpace,
  NSpin,
  NTag,
  NText,
  NTooltip,
} from 'naive-ui'
import {
  canOpenInWebTerminal,
  getHostAccessProtocolCapabilities,
  type HostPublic,
} from '@nodeaccess/shared'
import { hostService } from '@/services/host.service'
import { useAuthStore } from '@/stores/auth'
import { handleExpiredSession } from '@/services/auth-session.service'
import {
  GuacdClipboardStreamDecoder,
  GuacdDisplayCommandDecoder,
  GuacdInstructionBuffer,
  type GuacdRenderCommand,
  createGuacdAckResponse,
  createGuacdSyncResponse,
  encodeGuacdClipboardText,
  encodeGuacdKey,
  encodeGuacdMouse,
  encodeGuacdSize,
  keysymFromKeyboardEvent,
  resolveGuacdDisplayMetrics,
} from '@/services/graphical-guacd-client'

type GraphicalSessionStatus = 'loading' | 'connecting' | 'pending' | 'connected' | 'disconnecting' | 'closed' | 'not-applicable' | 'error'
type RdpCredentialMode = 'remote-login' | 'session'

interface GraphicalGatewaySessionMessage {
  type: 'graphical_gateway_pending' | 'graphical_gateway_connected'
  code: 'GRAPHICAL_GATEWAY_PENDING' | 'GRAPHICAL_GATEWAY_CONNECTED'
  sessionId?: number
  connectionMethod?: 'rdp_gateway_pending' | 'vnc_gateway_pending'
  protocol: HostPublic['accessProtocol']
  hostId: number
  hostName: string
  message: string
}

interface GraphicalGatewayGuacdMessage {
  type: 'guacd'
  data: string
}

interface GraphicalGatewayErrorMessage {
  type: 'error'
  code?: string
  message?: string
}

interface GraphicalGatewayInputForwardedMessage {
  type: 'graphical_gateway_input_forwarded'
  count: number
  lastOpcode: string | null
}

interface GraphicalGatewayClosedMessage {
  type: 'closed'
  reason: string
}

interface GraphicalGatewayCredentialsRequiredMessage {
  type: 'graphical_credentials_required'
  code: 'RDP_CREDENTIALS_REQUIRED'
  message: string
}

interface SentDisplayMetrics {
  width: number
  height: number
  dpi: number
}

const TOKEN_REFRESH_TTL = 60

// Opcodes that legitimately return null from the display decoder (state-setters or non-display protocol)
const EXPECTED_NULL_DISPLAY_OPCODES = new Set([
  'rect', 'img', 'blob', 'end', 'clipboard',
  'sync', 'nop', 'error', 'disconnect', 'name', 'required', 'argv', 'ack',
  'select', 'args', 'connect', 'ready', 'set', 'identity',
])

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()
const props = withDefaults(defineProps<{
  hostId?: number
  embedded?: boolean
  visible?: boolean
}>(), {
  embedded: false,
  visible: true,
})
const emit = defineEmits<{
  connected: [hostName: string]
  'session-change': [sessionId: number | null]
  'status-change': [status: GraphicalSessionStatus]
  'remote-closed': []
}>()
const READBACK_CONTEXT_OPTIONS: CanvasRenderingContext2DSettings = { willReadFrequently: true }

const host = ref<HostPublic | null>(null)
const status = ref<GraphicalSessionStatus>('loading')
const errorMessage = ref<string | null>(null)
const gatewayMessage = ref<GraphicalGatewaySessionMessage | null>(null)
const socketClosed = ref(false)
const guacdFrameCount = ref(0)
const guacdByteCount = ref(0)
const guacdInstructionCount = ref(0)
const lastGuacdOpcode = ref<string | null>(null)
const opcodeCounts = ref<Record<string, number>>({})
const renderedOpcodeCounts = ref<Record<string, number>>({})
const guacdSyncCount = ref(0)
const guacdAckCount = ref(0)
const guacdRenderCount = ref(0)
const meaningfulRemoteImageSeen = ref(false)
const imageRenderErrorCount = ref(0)
const clipboardSendCount = ref(0)
const clipboardReceiveCount = ref(0)
const clipboardMessage = ref<string | null>(null)
const remoteVideoMessage = ref<string | null>(null)
const transientMessage = ref<string | null>(null)
const remoteVideoCredentialFallback = ref(false)
const credentialsModalVisible = ref(false)
const credentialsMessage = ref<string | null>(null)
const rdpCredentialForm = ref({
  username: '',
  password: '',
  domain: '',
})
const displayWidth = ref(1280)
const displayHeight = ref(720)
const viewportWidth = ref(1280)
const viewportHeight = ref(720)
const inputEventCount = ref(0)
const inputSendCount = ref(0)
const inputForwardedCount = ref(0)
const lastInputOpcode = ref<string | null>(null)
const lastInputInstruction = ref<string | null>(null)
const showDetails = ref(false)
const isFullscreen = ref(false)
const fullscreenSupported = ref(false)
const sessionRootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const displayShellRef = ref<HTMLElement | null>(null)
const guacdBuffer = new GuacdInstructionBuffer()
const guacdDisplayDecoder = new GuacdDisplayCommandDecoder()
const guacdClipboardDecoder = new GuacdClipboardStreamDecoder()
const layerCanvases = new Map<string, HTMLCanvasElement>()
const layerPositions = new Map<string, { parentLayer: string; x: number; y: number; z: number }>()
const layerOpacities = new Map<string, number>()
const layerClips = new Map<string, { x: number; y: number; width: number; height: number } | null>()
const unknownDisplayOpcodeCounts = ref<Record<string, number>>({})
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null
let resizeDebounceTimer: number | null = null
let renderQueue = Promise.resolve()
let disconnectFallbackTimer: number | null = null
let remoteVideoFallbackTimer: number | null = null
let transientMessageTimer: number | null = null
let redirectAfterDisconnectTimer: number | null = null
let rdpActivationWakeupTimers: number[] = []
let disconnectScrollY: number | null = null
let redirectAfterUserDisconnect = false
let mouseButtonMask = 0
let mouseMoveFrame: number | null = null
let pendingMouseMove: { clientX: number; clientY: number; mask: number } | null = null
let clipboardStreamIndex = 1
let lastSentDisplayMetrics: SentDisplayMetrics | null = null
let initialMouseWakeupSent = false
let rdpSyntheticWakeupCount = 0
let lastRdpSyntheticWakeupAt = 0

const MEANINGFUL_REMOTE_IMAGE_MIN_BYTES = 1_000
const MEANINGFUL_REMOTE_IMAGE_MIN_AREA = 1_024
const MAX_RDP_SYNTHETIC_WAKEUPS = 8
const RDP_SYNTHETIC_WAKEUP_MIN_INTERVAL_MS = 300

const hostId = computed(() => {
  if (props.hostId && Number.isInteger(props.hostId) && props.hostId > 0) return props.hostId
  const raw = Array.isArray(route.params.hostId) ? route.params.hostId[0] : route.params.hostId
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})
const hostsHref = computed(() => router.resolve({ name: 'hosts' }).href)
const shouldPreserveDedicatedSessionOnBack = computed(() =>
  !props.embedded && !['disconnecting', 'closed', 'not-applicable', 'error'].includes(status.value),
)

const protocolLabel = computed(() => {
  const protocol = gatewayMessage.value?.protocol ?? host.value?.accessProtocol ?? 'rdp'
  return t(`hosts.protocols.${protocol}`)
})

const statusLabel = computed(() => {
  if (status.value === 'loading') return t('graphicalSession.status.loading')
  if (status.value === 'connecting') return t('graphicalSession.status.connecting')
  if (status.value === 'connected') return t('graphicalSession.status.connected')
  if (status.value === 'disconnecting') return t('graphicalSession.status.disconnecting')
  if (status.value === 'closed') return t('graphicalSession.status.closed')
  if (status.value === 'pending') return socketClosed.value
    ? t('graphicalSession.status.reserved')
    : t('graphicalSession.status.connected')
  if (status.value === 'not-applicable') return t('graphicalSession.status.notApplicable')
  return t('graphicalSession.status.error')
})

const connectionMethodLabel = computed(() => {
  const method = gatewayMessage.value?.connectionMethod
  if (method === 'rdp_gateway_pending') return t('graphicalSession.connectionMethods.rdpGatewayPending')
  if (method === 'vnc_gateway_pending') return t('graphicalSession.connectionMethods.vncGatewayPending')
  return '-'
})

const opcodeSummary = computed(() => summarizeCounts(opcodeCounts.value))
const renderedOpcodeSummary = computed(() => summarizeCounts(renderedOpcodeCounts.value))
const unknownDisplayOpcodeSummary = computed(() => summarizeCounts(unknownDisplayOpcodeCounts.value))
const layerSummary = ref('-')
const sessionRootClass = computed(() => [
  'flex w-full flex-col',
  isFullscreen.value
    ? 'h-screen bg-black'
    : props.embedded
      ? 'h-full min-h-0 bg-[#111827]'
      : 'gap-2 mx-auto max-w-[1720px] p-2 md:p-3',
])
const sessionCanvasMinHeightClass = computed(() =>
  isFullscreen.value ? 'h-full' : props.embedded ? 'h-full min-h-0' : 'min-h-[calc(100vh-104px)]'
)
const sessionCanvasHostClass = computed(() =>
  isFullscreen.value ? 'h-full' : props.embedded ? 'h-full min-h-0' : 'h-[calc(100vh-104px)] min-h-[420px]'
)
const graphicalDebugEnabled = computed(() =>
  route.query.rdpDebug === '1'
  || (typeof window !== 'undefined' && window.localStorage.getItem('na_rdp_debug') === '1')
)

const hostTooltipRows = computed(() => [
  { label: t('common.type'), value: protocolLabel.value },
  { label: t('common.status'), value: statusLabel.value },
  { label: t('graphicalSession.details.connectionMethod'), value: connectionMethodLabel.value },
  ...(gatewayMessage.value?.message
    ? [{ label: t('graphicalSession.details.gatewayMessage'), value: gatewayMessage.value.message }]
    : []),
])

function debugGraphical(event: string, payload: Record<string, unknown> = {}) {
  if (!graphicalDebugEnabled.value) return
  const entry = {
    status: status.value,
    remote: `${displayWidth.value}x${displayHeight.value}`,
    viewport: `${viewportWidth.value}x${viewportHeight.value}`,
    syncs: guacdSyncCount.value,
    renders: guacdRenderCount.value,
    frames: guacdFrameCount.value,
    ...payload,
  }
  console.debug(`[graphical-rdp] ${event}`, entry)
  sendGraphicalDebugToGateway(event, entry)
}

function showTransientMessage(message: string | null, ttlMs = 4500) {
  if (transientMessageTimer !== null) window.clearTimeout(transientMessageTimer)
  transientMessageTimer = null
  transientMessage.value = message
  if (!message) return
  transientMessageTimer = window.setTimeout(() => {
    transientMessage.value = null
    transientMessageTimer = null
  }, ttlMs)
}

function setClipboardMessage(message: string | null) {
  clipboardMessage.value = message
  if (message) showTransientMessage(message)
}

function setRemoteVideoMessage(message: string | null) {
  remoteVideoMessage.value = message
  if (message) showTransientMessage(message, 6000)
}

function redirectToHostsAfterDisconnect() {
  if (props.embedded || !redirectAfterUserDisconnect || redirectAfterDisconnectTimer !== null) return
  redirectAfterDisconnectTimer = window.setTimeout(() => {
    redirectAfterUserDisconnect = false
    redirectAfterDisconnectTimer = null
    void router.push({ name: 'hosts' })
  }, 350)
}

function sendGraphicalDebugToGateway(event: string, payload: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  if (!shouldForwardGraphicalDebug(event, payload)) return
  ws.send(JSON.stringify({ type: 'graphical_debug', event, payload }))
}

function shouldForwardGraphicalDebug(event: string, payload: Record<string, unknown>) {
  if (event === 'client-input' && payload.opcode === 'mouse') {
    const sends = typeof payload.inputSends === 'number' ? payload.inputSends : inputSendCount.value
    const instruction = typeof payload.instruction === 'string' ? payload.instruction : ''
    const args = parseGuacdInstructionArgs(instruction)
    const mask = Number(args.at(-1) ?? 0)
    return sends <= 5 || mask !== 0 || sends % 25 === 0
  }
  if (event !== 'guacd-instruction') return true
  if (payload.opcode !== 'sync') return true
  const syncs = typeof payload.syncs === 'number' ? payload.syncs : 0
  return syncs <= 5 || syncs % 50 === 0
}

function parseGuacdInstructionArgs(data: string): string[] {
  const values: string[] = []
  let offset = 0
  while (offset < data.length) {
    const dotIndex = data.indexOf('.', offset)
    if (dotIndex === -1) return []
    const length = Number(data.slice(offset, dotIndex))
    if (!Number.isInteger(length) || length < 0) return []
    const start = dotIndex + 1
    const end = start + length
    if (data.length <= end) return []
    values.push(data.slice(start, end))
    const separator = data[end]
    if (separator === ';') return values.slice(1)
    if (separator !== ',') return []
    offset = end + 1
  }
  return []
}

function sampleCanvasPixels(canvas: HTMLCanvasElement | null) {
  if (!canvas || canvas.width < 1 || canvas.height < 1) return null
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = Math.min(canvas.width, 32)
  sampleCanvas.height = Math.min(canvas.height, 24)
  const ctx = sampleCanvas.getContext('2d', READBACK_CONTEXT_OPTIONS)
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height)
  const data = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data
  let pixels = 0
  let bright = 0
  const unique = new Set<string>()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    unique.add([r >> 4, g >> 4, b >> 4].join(','))
    if (r > 120 || g > 120 || b > 120) bright += 1
    pixels += 1
  }
  return { width: canvas.width, height: canvas.height, pixels, bright, unique: unique.size }
}

function sampleCanvasState() {
  return sampleCanvasPixels(canvasRef.value ?? null)
}

function hasUsefulCanvasFrame() {
  const sample = sampleCanvasState()
  return Boolean(meaningfulRemoteImageSeen.value && sample && sample.bright >= 20 && sample.unique >= 4)
}

function sampleImageState(image: HTMLImageElement) {
  const width = Math.max(1, image.naturalWidth || image.width)
  const height = Math.max(1, image.naturalHeight || image.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(width, 96)
  canvas.height = Math.min(height, 72)
  const ctx = canvas.getContext('2d', READBACK_CONTEXT_OPTIONS)
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return sampleCanvasPixels(canvas)
}

function describeRenderCommand(command: GuacdRenderCommand): Record<string, unknown> {
  if (command.type === 'image') {
    return {
      type: command.type,
      layer: command.layer,
      mimeType: command.mimeType,
      x: command.x,
      y: command.y,
      bytes: command.data.length,
    }
  }
  return { ...command }
}

function getTokenExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!))
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

function isExpiringSoon(token: string): boolean {
  const exp = getTokenExp(token)
  if (exp === null) return true
  return (exp - Date.now() / 1000) < TOKEN_REFRESH_TTL
}

async function refreshTokenIfNeeded(): Promise<boolean> {
  if (!auth.accessToken || !isExpiringSoon(auth.accessToken)) return true
  const ok = await auth.refresh()
  if (!ok) {
    window.setTimeout(() => { void handleExpiredSession() }, 300)
  }
  return ok
}

function closeSocket() {
  clearRdpActivationWakeups()
  ws?.close(1000)
  ws = null
}

function clearDisconnectFallback() {
  if (!disconnectFallbackTimer) return
  window.clearTimeout(disconnectFallbackTimer)
  disconnectFallbackTimer = null
}

function clearRemoteVideoFallback() {
  if (!remoteVideoFallbackTimer) return
  window.clearTimeout(remoteVideoFallbackTimer)
  remoteVideoFallbackTimer = null
}

function clearRdpActivationWakeups() {
  for (const timer of rdpActivationWakeupTimers) window.clearTimeout(timer)
  rdpActivationWakeupTimers = []
}

function startRemoteVideoFallback() {
  clearRemoteVideoFallback()
  remoteVideoFallbackTimer = window.setTimeout(() => {
    if (status.value !== 'connected' || guacdRenderCount.value > 0) return
    setRemoteVideoMessage(t('graphicalSession.remoteVideo.waiting'))
    remoteVideoCredentialFallback.value = true
    drawDisplayPlaceholder()
  }, 6_000)
}

function restoreDisconnectScroll() {
  if (disconnectScrollY === null) return
  const top = disconnectScrollY
  disconnectScrollY = null
  void nextTick(() => {
    window.scrollTo({ top })
  })
}

function resetGuacdStats() {
  guacdBuffer.reset()
  guacdDisplayDecoder.reset()
  guacdClipboardDecoder.reset()
  layerCanvases.clear()
  layerPositions.clear()
  layerOpacities.clear()
  layerClips.clear()
  renderQueue = Promise.resolve()
  if (canvasRef.value) canvasRef.value.style.cursor = 'auto'
  layerSummary.value = '-'
  guacdFrameCount.value = 0
  guacdByteCount.value = 0
  guacdInstructionCount.value = 0
  lastGuacdOpcode.value = null
  opcodeCounts.value = {}
  renderedOpcodeCounts.value = {}
  unknownDisplayOpcodeCounts.value = {}
  guacdSyncCount.value = 0
    guacdAckCount.value = 0
    guacdRenderCount.value = 0
    meaningfulRemoteImageSeen.value = false
  imageRenderErrorCount.value = 0
  clipboardSendCount.value = 0
  clipboardReceiveCount.value = 0
  setClipboardMessage(null)
  setRemoteVideoMessage(null)
  remoteVideoCredentialFallback.value = false
  inputEventCount.value = 0
  inputSendCount.value = 0
  inputForwardedCount.value = 0
  lastInputOpcode.value = null
  lastInputInstruction.value = null
  credentialsModalVisible.value = false
  credentialsMessage.value = null
  rdpCredentialForm.value = { username: '', password: '', domain: '' }
  mouseButtonMask = 0
  clearPendingMouseMove()
  clearRdpActivationWakeups()
  clipboardStreamIndex = 1
  lastSentDisplayMetrics = null
  initialMouseWakeupSent = false
  rdpSyntheticWakeupCount = 0
  lastRdpSyntheticWakeupAt = 0
  debugGraphical('reset')
}

function sendGuacd(data: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'guacd', data }))
}

function sendUserInputGuacd(data: string) {
  inputSendCount.value += 1
  lastInputOpcode.value = parseGuacdOpcode(data)
  lastInputInstruction.value = data
  debugGraphical('client-input', { opcode: lastInputOpcode.value, instruction: data, inputSends: inputSendCount.value })
  sendGuacd(data)
}

function summarizeCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
  if (entries.length === 0) return '-'
  return entries.map(([opcode, count]) => `${opcode}:${count}`).join(' ')
}

function incrementCount(target: typeof opcodeCounts, key: string) {
  target.value = {
    ...target.value,
    [key]: (target.value[key] ?? 0) + 1,
  }
}

function parseGuacdOpcode(data: string): string | null {
  const dotIndex = data.indexOf('.')
  if (dotIndex === -1) return null
  const length = Number(data.slice(0, dotIndex))
  if (!Number.isInteger(length) || length <= 0) return null
  return data.slice(dotIndex + 1, dotIndex + 1 + length) || null
}

function updateLayerSummary() {
  const layers = ['0', ...Array.from(layerCanvases.keys())]
    .filter((layer, index, all) => all.indexOf(layer) === index)
    .slice(0, 8)
  layerSummary.value = layers.length ? layers.join(' ') : '-'
}

function updateCanvasCssSize() {
  const canvas = canvasRef.value
  const shell = displayShellRef.value
  if (!canvas || !shell) return
  const rect = shell.getBoundingClientRect()
  viewportWidth.value = Math.max(320, Math.round(rect.width))
  viewportHeight.value = Math.max(240, Math.round(rect.height))

  canvas.style.imageRendering = 'auto'

  const cW = rect.width
  const cH = rect.height
  const bW = canvas.width || displayWidth.value
  const bH = canvas.height || displayHeight.value
  const sizesMatch = Math.abs(Math.round(cW) - Math.round(bW)) <= 2
    && Math.abs(Math.round(cH) - Math.round(bH)) <= 2

  if (sizesMatch || bW <= 0 || bH <= 0 || cW <= 0 || cH <= 0) {
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.right = 'auto'
    canvas.style.bottom = 'auto'
    return
  }

  const scale = Math.min(cW / bW, cH / bH)
  const w = Math.round(bW * scale)
  const h = Math.round(bH * scale)
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.style.left = `${Math.round((cW - w) / 2)}px`
  canvas.style.top = `${Math.round((cH - h) / 2)}px`
  canvas.style.right = 'auto'
  canvas.style.bottom = 'auto'
}

async function measureDisplayLayout() {
  await waitForDisplayLayout()
  updateDisplaySize()
}

function drawDisplayPlaceholder() {
  const canvas = canvasRef.value
  if (!canvas) return
  if (status.value === 'connected' && guacdRenderCount.value > 0) {
    debugGraphical('placeholder-skip', {
      reason: 'rendered-frame-present',
      canvas: sampleCanvasState(),
    })
    updateCanvasCssSize()
    return
  }
  canvas.width = Math.max(1, Math.round(displayWidth.value))
  canvas.height = Math.max(1, Math.round(displayHeight.value))
  updateCanvasCssSize()

  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, displayWidth.value, displayHeight.value)
  ctx.strokeStyle = status.value === 'connected' ? '#16a34a' : '#4b5563'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, displayWidth.value - 1, displayHeight.value - 1)
  ctx.fillStyle = '#9ca3af'
  ctx.font = '14px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(statusLabel.value, displayWidth.value / 2, displayHeight.value / 2)
  debugGraphical('placeholder-draw', { canvas: sampleCanvasState() })
}

function setCanvasBackingSize(width: number, height: number) {
  const canvas = canvasRef.value
  if (!canvas) return null
  displayWidth.value = Math.max(1, Math.round(width))
  displayHeight.value = Math.max(1, Math.round(height))
  canvas.width = Math.max(1, Math.round(displayWidth.value))
  canvas.height = Math.max(1, Math.round(displayHeight.value))
  updateCanvasCssSize()
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

function getLayerCanvas(layer: string): HTMLCanvasElement | null {
  if (layer === '0') return canvasRef.value
  let canvas = layerCanvases.get(layer)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, displayWidth.value)
    canvas.height = Math.max(1, displayHeight.value)
    layerCanvases.set(layer, canvas)
    updateLayerSummary()
  }
  return canvas
}

function findLayerCanvas(layer: string): HTMLCanvasElement | null {
  return layer === '0' ? canvasRef.value : layerCanvases.get(layer) ?? null
}

function setLayerBackingSize(layer: string, width: number, height: number): CanvasRenderingContext2D | null {
  if (layer === '0') return setCanvasBackingSize(width, height)

  const canvas = getLayerCanvas(layer)
  if (!canvas) return null
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
  }
  return ctx
}

function getLayerContext(layer: string): CanvasRenderingContext2D | null {
  const canvas = getLayerCanvas(layer)
  const ctx = canvas?.getContext('2d') ?? null
  if (ctx) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
  }
  return ctx
}

function applyRenderCommand(command: GuacdRenderCommand): Promise<void> {
  renderQueue = renderQueue
    .then(() => executeRenderCommand(command))
    .then(() => {
      debugGraphical('render-complete', {
        command: describeRenderCommand(command),
        canvas: sampleCanvasState(),
        layers: layerSummary.value,
      })
    })
    .catch(() => {
      imageRenderErrorCount.value += 1
      debugGraphical('render-error', { command: describeRenderCommand(command) })
    })
  return renderQueue
}

async function executeRenderCommand(command: GuacdRenderCommand) {
  const canvas = canvasRef.value
  if (!canvas) return

  if (command.type === 'resize') {
    const ctx = setLayerBackingSize(command.layer, command.width, command.height)
    if (!ctx) return
    if (command.layer === '0') {
      ctx.fillStyle = '#0b1220'
      ctx.fillRect(0, 0, displayWidth.value, displayHeight.value)
    }
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'cursor') {
    applyCursorCommand(command)
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'fillRect') {
    const ctx = getLayerContext(command.layer)
    if (!ctx) return
    ctx.fillStyle = command.color
    ctx.fillRect(command.x, command.y, command.width, command.height)
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'copy') {
    const ctx = getLayerContext(command.dstLayer)
    if (!ctx) return
    const source = getLayerCanvas(command.srcLayer)
    if (!source) return
    if (source === ctx.canvas) {
      const snapshot = document.createElement('canvas')
      snapshot.width = Math.max(1, Math.round(command.width))
      snapshot.height = Math.max(1, Math.round(command.height))
      snapshot.getContext('2d')?.drawImage(
        source,
        command.srcX,
        command.srcY,
        command.width,
        command.height,
        0,
        0,
        command.width,
        command.height,
      )
      ctx.drawImage(snapshot, command.dstX, command.dstY)
    } else {
      ctx.drawImage(
        source,
        command.srcX,
        command.srcY,
        command.width,
        command.height,
        command.dstX,
        command.dstY,
        command.width,
        command.height,
      )
    }
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'move') {
    layerPositions.set(command.layer, { parentLayer: command.parentLayer, x: command.x, y: command.y, z: command.z })
    const srcCanvas = findLayerCanvas(command.layer)
    const dstCtx = getLayerContext(command.parentLayer)
    if (srcCanvas && dstCtx) {
      dstCtx.drawImage(srcCanvas, command.x, command.y)
    }
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'dispose') {
    layerCanvases.delete(command.layer)
    layerPositions.delete(command.layer)
    layerOpacities.delete(command.layer)
    layerClips.delete(command.layer)
    updateLayerSummary()
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'transfer') {
    const dstCtx = getLayerContext(command.dstLayer)
    if (!dstCtx) return
    const srcCanvas = getLayerCanvas(command.srcLayer)
    if (!srcCanvas) return
    const compositeOp = guacdTransferFnToCompositeOp(command.fn)
    dstCtx.save()
    dstCtx.globalCompositeOperation = compositeOp
    if (srcCanvas === dstCtx.canvas) {
      const snapshot = document.createElement('canvas')
      snapshot.width = Math.max(1, Math.round(command.width))
      snapshot.height = Math.max(1, Math.round(command.height))
      snapshot.getContext('2d')?.drawImage(srcCanvas, command.srcX, command.srcY, command.width, command.height, 0, 0, command.width, command.height)
      dstCtx.drawImage(snapshot, command.dstX, command.dstY)
    } else {
      dstCtx.drawImage(srcCanvas, command.srcX, command.srcY, command.width, command.height, command.dstX, command.dstY, command.width, command.height)
    }
    dstCtx.restore()
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'lfill') {
    const dstCtx = getLayerContext(command.layer)
    const srcCanvas = getLayerCanvas(command.srcLayer)
    if (!dstCtx || !srcCanvas) return
    const pattern = dstCtx.createPattern(srcCanvas, 'repeat')
    if (!pattern) return
    dstCtx.save()
    dstCtx.beginPath()
    dstCtx.rect(command.x, command.y, command.width, command.height)
    dstCtx.clip()
    dstCtx.fillStyle = pattern
    dstCtx.fillRect(command.x, command.y, command.width, command.height)
    dstCtx.restore()
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'clip') {
    layerClips.set(command.layer, { x: command.x, y: command.y, width: command.width, height: command.height })
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'reset') {
    layerClips.delete(command.layer)
    guacdRenderCount.value += 1
    return
  }

  if (command.type === 'shade') {
    layerOpacities.set(command.layer, command.opacity)
    guacdRenderCount.value += 1
    return
  }

  const ctx = getLayerContext(command.layer)
  if (!ctx) return
  const image = await loadImage(`data:${command.mimeType};base64,${command.data}`)
  ctx.drawImage(image, command.x, command.y)
  guacdRenderCount.value += 1
  const imageArea = Math.max(1, image.naturalWidth || image.width) * Math.max(1, image.naturalHeight || image.height)
  if (command.layer === '0' && (
    command.data.length >= MEANINGFUL_REMOTE_IMAGE_MIN_BYTES ||
    imageArea >= MEANINGFUL_REMOTE_IMAGE_MIN_AREA
  )) {
    meaningfulRemoteImageSeen.value = true
  }
  debugGraphical('image-draw-complete', {
    command: describeRenderCommand(command),
    image: sampleImageState(image),
    canvas: sampleCanvasState(),
  })
}

function applyCursorCommand(command: Extract<GuacdRenderCommand, { type: 'cursor' }>) {
  const canvas = canvasRef.value
  if (!canvas) return

  const source = findLayerCanvas(command.srcLayer)
  if (!source) {
    canvas.style.cursor = 'auto'
    return
  }

  try {
    const cursorCanvas = document.createElement('canvas')
    cursorCanvas.width = Math.max(1, Math.round(command.width))
    cursorCanvas.height = Math.max(1, Math.round(command.height))
    const cursorCtx = cursorCanvas.getContext('2d', READBACK_CONTEXT_OPTIONS)
    if (!cursorCtx) {
      canvas.style.cursor = 'auto'
      return
    }

    cursorCtx.imageSmoothingEnabled = false
    cursorCtx.drawImage(
      source,
      command.srcX,
      command.srcY,
      command.width,
      command.height,
      0,
      0,
      command.width,
      command.height,
    )

    const imageData = cursorCtx.getImageData(0, 0, cursorCanvas.width, cursorCanvas.height)
    const hasVisiblePixels = imageData.data.some((v, i) => i % 4 === 3 && v > 0)
    if (!hasVisiblePixels) {
      canvas.style.cursor = 'auto'
      return
    }

    const hotspotX = Math.min(Math.max(Math.round(command.hotspotX), 0), cursorCanvas.width - 1)
    const hotspotY = Math.min(Math.max(Math.round(command.hotspotY), 0), cursorCanvas.height - 1)
    canvas.style.cursor = `url("${cursorCanvas.toDataURL('image/png')}") ${hotspotX} ${hotspotY}, auto`
  } catch {
    canvas.style.cursor = 'auto'
  }
}

function guacdTransferFnToCompositeOp(fn: number): GlobalCompositeOperation {
  switch (fn) {
    case 0x00: return 'destination-out'  // BLACKNESS
    case 0x88: return 'source-in'        // SRCAND
    case 0xCC: return 'copy'             // SRCCOPY
    case 0xEE: return 'source-over'      // SRCPAINT (OR)
    case 0xF0: return 'source-over'      // PATCOPY
    default:   return 'source-over'
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Falha ao carregar imagem do protocolo gráfico'))
    image.src = src
  })
}

function updateDisplaySize() {
  if (props.embedded && !props.visible) return
  const shell = displayShellRef.value
  if (!shell) return
  const rect = shell.getBoundingClientRect()
  if (props.embedded && (rect.width < 1 || rect.height < 1)) return
  viewportWidth.value = Math.max(320, Math.round(rect.width))
  viewportHeight.value = Math.max(240, Math.round(rect.height))
  const displayMetrics = resolveGuacdDisplayMetrics(viewportWidth.value, viewportHeight.value, window.devicePixelRatio || 1)
  if (status.value === 'connected') {
    updateCanvasCssSize()
    sendDisplaySizeIfChanged(displayMetrics, guacdRenderCount.value > 0 || guacdSyncCount.value > 0)
  } else {
    displayWidth.value = displayMetrics.width
    displayHeight.value = displayMetrics.height
    drawDisplayPlaceholder()
  }
}

function displayMetricsMatch(a: SentDisplayMetrics, b: SentDisplayMetrics): boolean {
  return Math.abs(a.width - b.width) <= 2
    && Math.abs(a.height - b.height) <= 2
    && a.dpi === b.dpi
}

function sendDisplaySizeIfChanged(metrics: SentDisplayMetrics, wakeAfterResize: boolean) {
  if (lastSentDisplayMetrics && displayMetricsMatch(lastSentDisplayMetrics, metrics)) return
  debugGraphical('send-size', {
    previous: lastSentDisplayMetrics,
    next: metrics,
    wakeAfterResize,
  })
  lastSentDisplayMetrics = {
    width: metrics.width,
    height: metrics.height,
    dpi: metrics.dpi,
  }
  sendGuacd(encodeGuacdSize(metrics.width, metrics.height, metrics.dpi))
  if (wakeAfterResize) window.setTimeout(() => sendMouseWakeup(false), 120)
}

function sendMouseWakeup(withClick: boolean, clickDelayMs = 120, xRatio = 0.5, yRatio = 0.5) {
  if (status.value !== 'connected') return
  const cx = Math.round(displayWidth.value * xRatio)
  const cy = Math.round(displayHeight.value * yRatio)
  debugGraphical('mouse-wakeup-start', { x: cx, y: cy, xRatio, yRatio, withClick, clickDelayMs })
  sendUserInputGuacd(encodeGuacdMouse(cx, cy, 0))
  if (!withClick) return
  window.setTimeout(() => {
    if (status.value !== 'connected') return
    debugGraphical('mouse-wakeup-click', { x: cx, y: cy })
    sendUserInputGuacd(encodeGuacdMouse(cx, cy, 1))
    sendUserInputGuacd(encodeGuacdMouse(cx, cy, 0))
  }, clickDelayMs)
}

function isCurrentRdpSession() {
  return (gatewayMessage.value?.protocol ?? host.value?.accessProtocol) === 'rdp'
}

function shouldSendRdpActivationWakeup() {
  return status.value === 'connected'
    && isCurrentRdpSession()
    && inputEventCount.value === 0
    && !hasUsefulCanvasFrame()
}

function sendRdpSyntheticWakeup(reason: string, xRatio = 0.5, yRatio = 0.4, clickDelayMs = 80) {
  if (!shouldSendRdpActivationWakeup()) return
  if (rdpSyntheticWakeupCount >= MAX_RDP_SYNTHETIC_WAKEUPS) return
  const now = Date.now()
  if (now - lastRdpSyntheticWakeupAt < RDP_SYNTHETIC_WAKEUP_MIN_INTERVAL_MS) return
  rdpSyntheticWakeupCount += 1
  lastRdpSyntheticWakeupAt = now
  debugGraphical('rdp-synthetic-wakeup', {
    reason,
    count: rdpSyntheticWakeupCount,
    xRatio,
    yRatio,
    inputEvents: inputEventCount.value,
    renders: guacdRenderCount.value,
    syncs: guacdSyncCount.value,
    meaningfulRemoteImageSeen: meaningfulRemoteImageSeen.value,
    canvas: sampleCanvasState(),
  })
  sendMouseWakeup(true, clickDelayMs, xRatio, yRatio)
}

function sendInitialMouseWakeup() {
  if (initialMouseWakeupSent) return
  initialMouseWakeupSent = true
  sendRdpSyntheticWakeup('first-sync', 0.5, 0.4, 120)
}

function scheduleRdpActivationWakeups() {
  clearRdpActivationWakeups()
  if (!isCurrentRdpSession()) return
  const attempts = [
    { delayMs: 120, xRatio: 0.5, yRatio: 0.4 },
    { delayMs: 600, xRatio: 0.5, yRatio: 0.4 },
    { delayMs: 1_200, xRatio: 0.5, yRatio: 0.5 },
    { delayMs: 2_200, xRatio: 0.5, yRatio: 0.4 },
    { delayMs: 3_500, xRatio: 0.5, yRatio: 0.4 },
    { delayMs: 5_000, xRatio: 0.13, yRatio: 0.51 },
    { delayMs: 6_500, xRatio: 0.13, yRatio: 0.51 },
  ]
  for (const { delayMs, xRatio, yRatio } of attempts) {
    const timer = window.setTimeout(() => {
      rdpActivationWakeupTimers = rdpActivationWakeupTimers.filter((item) => item !== timer)
      if (!shouldSendRdpActivationWakeup()) {
        debugGraphical('rdp-activation-wakeup-skip', {
          delayMs,
          inputEvents: inputEventCount.value,
          renders: guacdRenderCount.value,
          meaningfulRemoteImageSeen: meaningfulRemoteImageSeen.value,
          canvas: sampleCanvasState(),
        })
        return
      }
      sendRdpSyntheticWakeup(`timer-${delayMs}`, xRatio, yRatio, 80)
    }, delayMs)
    rdpActivationWakeupTimers.push(timer)
  }
}

function sendCtrlAltDel() {
  if (status.value !== 'connected') return
  sendUserInputGuacd(encodeGuacdKey(0xffe3, true))
  sendUserInputGuacd(encodeGuacdKey(0xffe9, true))
  sendUserInputGuacd(encodeGuacdKey(0xffff, true))
  sendUserInputGuacd(encodeGuacdKey(0xffff, false))
  sendUserInputGuacd(encodeGuacdKey(0xffe9, false))
  sendUserInputGuacd(encodeGuacdKey(0xffe3, false))
}

function handleFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === sessionRootRef.value
  void nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateDisplaySize()
        focusCanvas()
      })
    })
  })
}

function waitForDisplayLayout(): Promise<void> {
  return nextTick().then(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  }))
}

async function toggleFullscreen() {
  const root = sessionRootRef.value
  if (!root || !document.fullscreenEnabled) return

  if (document.fullscreenElement === root) {
    await document.exitFullscreen()
  } else {
    await root.requestFullscreen()
  }
}

function currentInitialDisplayParams(): { width: number; height: number; dpi: number } {
  updateDisplaySize()
  const normalViewportHeight = Math.round(window.innerHeight - 200)
  const initialHeight = isFullscreen.value
    ? viewportHeight.value
    : props.embedded
      ? viewportHeight.value
    : Math.max(viewportHeight.value, normalViewportHeight)
  const displayMetrics = resolveGuacdDisplayMetrics(
    viewportWidth.value,
    Math.max(240, initialHeight),
    window.devicePixelRatio || 1,
  )
  return {
    width: displayMetrics.width,
    height: displayMetrics.height,
    dpi: displayMetrics.dpi,
  }
}

function focusCanvas() {
  canvasRef.value?.focus()
}

function scaledMousePositionFromClient(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const x = ((clientX - rect.left) / Math.max(rect.width, 1)) * displayWidth.value
  const y = ((clientY - rect.top) / Math.max(rect.height, 1)) * displayHeight.value
  return {
    x: Math.min(Math.max(x, 0), displayWidth.value),
    y: Math.min(Math.max(y, 0), displayHeight.value),
  }
}

function scaledMousePosition(event: MouseEvent): { x: number; y: number } {
  return scaledMousePositionFromClient(event.clientX, event.clientY)
}

function updateButtonMask(event: MouseEvent, pressed: boolean) {
  const bit = event.button === 0 ? 1 : event.button === 1 ? 2 : event.button === 2 ? 4 : 0
  if (!bit) return
  mouseButtonMask = pressed ? mouseButtonMask | bit : mouseButtonMask & ~bit
}

function sendMouseEvent(event: MouseEvent, nextMask = mouseButtonMask) {
  if (status.value !== 'connected') return
  const { x, y } = scaledMousePosition(event)
  inputEventCount.value += 1
  sendUserInputGuacd(encodeGuacdMouse(x, y, nextMask))
}

function sendMouseMoveFromClient(clientX: number, clientY: number, nextMask = mouseButtonMask) {
  if (status.value !== 'connected') return
  const { x, y } = scaledMousePositionFromClient(clientX, clientY)
  inputEventCount.value += 1
  sendUserInputGuacd(encodeGuacdMouse(x, y, nextMask))
}

function clearPendingMouseMove() {
  if (mouseMoveFrame !== null) {
    window.cancelAnimationFrame(mouseMoveFrame)
    mouseMoveFrame = null
  }
  pendingMouseMove = null
}

function flushPendingMouseMove() {
  if (mouseMoveFrame !== null) {
    window.cancelAnimationFrame(mouseMoveFrame)
    mouseMoveFrame = null
  }
  const pending = pendingMouseMove
  pendingMouseMove = null
  if (pending) sendMouseMoveFromClient(pending.clientX, pending.clientY, pending.mask)
}

function scheduleMouseMove(event: MouseEvent) {
  if (status.value !== 'connected') return
  pendingMouseMove = {
    clientX: event.clientX,
    clientY: event.clientY,
    mask: mouseButtonMask,
  }
  if (mouseMoveFrame !== null) return
  mouseMoveFrame = window.requestAnimationFrame(() => {
    mouseMoveFrame = null
    const pending = pendingMouseMove
    pendingMouseMove = null
    if (!pending) return
    sendMouseMoveFromClient(pending.clientX, pending.clientY, pending.mask)
  })
}

function handleCanvasPointerDown(event: PointerEvent) {
  event.preventDefault()
  focusCanvas()
  event.currentTarget instanceof HTMLCanvasElement && event.currentTarget.setPointerCapture(event.pointerId)
  flushPendingMouseMove()
  updateButtonMask(event, true)
  sendMouseEvent(event)
}

function handleCanvasPointerUp(event: PointerEvent) {
  event.preventDefault()
  event.currentTarget instanceof HTMLCanvasElement && event.currentTarget.releasePointerCapture(event.pointerId)
  flushPendingMouseMove()
  updateButtonMask(event, false)
  sendMouseEvent(event)
}

function handleCanvasPointerMove(event: PointerEvent) {
  scheduleMouseMove(event)
}

function handleCanvasWheel(event: WheelEvent) {
  if (status.value !== 'connected') return
  event.preventDefault()
  flushPendingMouseMove()
  const wheelMask = event.deltaY < 0 ? 8 : 16
  sendMouseEvent(event, mouseButtonMask | wheelMask)
  sendMouseEvent(event, mouseButtonMask)
}

function handleCanvasKey(event: KeyboardEvent, pressed: boolean) {
  if (status.value !== 'connected') return
  const keysym = keysymFromKeyboardEvent(event)
  if (keysym === null) return
  event.preventDefault()
  inputEventCount.value += 1
  sendUserInputGuacd(encodeGuacdKey(keysym, pressed))
}

function sendClipboardText(text: string): boolean {
  if (status.value !== 'connected') return false
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized) return false
  const instructions = encodeGuacdClipboardText(normalized, clipboardStreamIndex++)
  for (const instruction of instructions) sendUserInputGuacd(instruction)
  clipboardSendCount.value += 1
  inputEventCount.value += instructions.length
  setClipboardMessage(t('graphicalSession.clipboard.sent'))
  focusCanvas()
  return true
}

async function sendClipboardFromBrowser() {
  if (status.value !== 'connected') return
  if (!navigator.clipboard?.readText) {
    setClipboardMessage(t('graphicalSession.clipboard.unavailable'))
    return
  }

  try {
    const text = await navigator.clipboard.readText()
    if (!sendClipboardText(text)) {
      setClipboardMessage(t('graphicalSession.clipboard.empty'))
    }
  } catch {
    setClipboardMessage(t('graphicalSession.clipboard.denied'))
  }
}

function handleCanvasPaste(event: ClipboardEvent) {
  if (status.value !== 'connected') return
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text) return
  event.preventDefault()
  sendClipboardText(text)
}

async function applyRemoteClipboard(text: string) {
  if (!text) return
  clipboardReceiveCount.value += 1
  if (!navigator.clipboard?.writeText) {
    setClipboardMessage(t('graphicalSession.clipboard.remoteUnavailable'))
    return
  }

  try {
    await navigator.clipboard.writeText(text)
    setClipboardMessage(t('graphicalSession.clipboard.remoteCopied'))
  } catch {
    setClipboardMessage(t('graphicalSession.clipboard.remoteDenied'))
  }
}

function parseGatewayMessage(data: string): GraphicalGatewaySessionMessage | GraphicalGatewayGuacdMessage | GraphicalGatewayErrorMessage | GraphicalGatewayInputForwardedMessage | GraphicalGatewayClosedMessage | GraphicalGatewayCredentialsRequiredMessage | null {
  try {
    const parsed = JSON.parse(data) as GraphicalGatewaySessionMessage | GraphicalGatewayGuacdMessage | GraphicalGatewayErrorMessage | GraphicalGatewayInputForwardedMessage | GraphicalGatewayClosedMessage | GraphicalGatewayCredentialsRequiredMessage
    return parsed && typeof parsed === 'object' && 'type' in parsed ? parsed : null
  } catch {
    return null
  }
}

function isRdpCredentialNegotiationError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('wrong security type')
    || normalized.includes('nla')
    || normalized.includes('credssp')
    || normalized.includes('authentication')
    || normalized.includes('credentials')
}

function handleGuacdError(args: string[]) {
  const remoteMessage = args[0]?.trim() || t('graphicalSession.errors.gateway')
  const isRdp = (gatewayMessage.value?.protocol ?? host.value?.accessProtocol) === 'rdp'
  const canRetryWithCredentials = isRdp && isRdpCredentialNegotiationError(remoteMessage)

  clearRemoteVideoFallback()
  status.value = 'error'
  errorMessage.value = canRetryWithCredentials
    ? t('graphicalSession.errors.rdpCredentialsRequired')
    : t('graphicalSession.errors.remoteProtocol', { message: remoteMessage })
  setRemoteVideoMessage(errorMessage.value)
  remoteVideoCredentialFallback.value = canRetryWithCredentials
  drawDisplayPlaceholder()
  closeSocket()
}

function sendRdpSessionCredentials() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const username = rdpCredentialForm.value.username.trim()
  const password = rdpCredentialForm.value.password
  const domain = rdpCredentialForm.value.domain.trim()
  if (!username || !password) return
  ws.send(JSON.stringify({
    type: 'graphical_credentials',
    username,
    password,
    ...(domain && { domain }),
  }))
  credentialsModalVisible.value = false
  credentialsMessage.value = null
}

function cancelRdpSessionCredentials() {
  credentialsModalVisible.value = false
  credentialsMessage.value = null
  errorMessage.value = 'Credenciais RDP não informadas.'
  status.value = 'error'
  closeSocket()
}

async function openGatewaySocket(currentHost: HostPublic, credentialMode: RdpCredentialMode = 'remote-login') {
  const ok = await refreshTokenIfNeeded()
  if (!ok || !auth.accessToken) {
    status.value = 'error'
    errorMessage.value = t('graphicalSession.errors.expired')
    return
  }

  closeSocket()
  socketClosed.value = false
  clearDisconnectFallback()
  gatewayMessage.value = null
  resetGuacdStats()
  clearRemoteVideoFallback()
  errorMessage.value = null
  status.value = 'connecting'

  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsBase = import.meta.env.VITE_WS_URL ?? `${wsProtocol}//${location.host}`
  const initialDisplay = currentInitialDisplayParams()
  lastSentDisplayMetrics = { ...initialDisplay }
  const query = new URLSearchParams({
    token: auth.accessToken,
    width: String(initialDisplay.width),
    height: String(initialDisplay.height),
    dpi: String(initialDisplay.dpi),
  })
  if (credentialMode === 'session') query.set('credentialMode', 'session')
  const url = `${wsBase}/ws/graphical/${currentHost.id}?${query.toString()}`
  ws = new WebSocket(url)
  const currentWs = ws

  ws.onmessage = (event: MessageEvent) => {
    if (ws !== currentWs || typeof event.data !== 'string') return
    const msg = parseGatewayMessage(event.data)
    if (!msg) return

    if (msg.type === 'graphical_gateway_pending') {
      gatewayMessage.value = msg
      status.value = 'pending'
      return
    }

    if (msg.type === 'graphical_credentials_required') {
      credentialsMessage.value = msg.message
      credentialsModalVisible.value = true
      status.value = 'connecting'
      return
    }

    if (msg.type === 'graphical_gateway_connected') {
      gatewayMessage.value = msg
      status.value = 'connected'
      emit('connected', msg.hostName)
      emit('session-change', msg.sessionId ?? null)
      debugGraphical('gateway-connected', { sessionId: msg.sessionId, protocol: msg.protocol })
      void measureDisplayLayout().then(() => {
        updateDisplaySize()
        drawDisplayPlaceholder()
	        focusCanvas()
        scheduleRdpActivationWakeups()
        startRemoteVideoFallback()
      })
      return
    }

	    if (msg.type === 'guacd') {
	      guacdFrameCount.value += 1
	      guacdByteCount.value += msg.data.length
      try {
        const instructions = guacdBuffer.push(msg.data)
        guacdInstructionCount.value += instructions.length
        for (const instruction of instructions) {
          lastGuacdOpcode.value = instruction.opcode
          incrementCount(opcodeCounts, instruction.opcode)
          if (instruction.opcode !== 'sync' || guacdSyncCount.value < 5 || graphicalDebugEnabled.value) {
            debugGraphical('guacd-instruction', {
              opcode: instruction.opcode,
              args: instruction.opcode === 'blob'
                ? [instruction.args[0], `[${instruction.args[1]?.length ?? 0} chars]`]
                : instruction.args,
            })
          }
          if (instruction.opcode === 'error') {
            handleGuacdError(instruction.args)
            return
          }
          const renderCommand = guacdDisplayDecoder.decode(instruction)
          if (renderCommand) {
	            clearRemoteVideoFallback()
	            setRemoteVideoMessage(null)
            remoteVideoCredentialFallback.value = false
            incrementCount(renderedOpcodeCounts, instruction.opcode)
            debugGraphical('render-command', {
              opcode: instruction.opcode,
              command: describeRenderCommand(renderCommand),
              before: renderCommand.type === 'image' || renderCommand.type === 'resize' ? sampleCanvasState() : null,
            })
            applyRenderCommand(renderCommand).then(() => {
              sendRdpSyntheticWakeup(`render-${instruction.opcode}`, 0.5, 0.4, 80)
            })
          } else if (!EXPECTED_NULL_DISPLAY_OPCODES.has(instruction.opcode)) {
            incrementCount(unknownDisplayOpcodeCounts, instruction.opcode)
          }
          const remoteClipboard = guacdClipboardDecoder.decode(instruction)
          if (remoteClipboard) {
            void applyRemoteClipboard(remoteClipboard.text)
          }
          const syncResponse = createGuacdSyncResponse(instruction)
          if (syncResponse) {
            guacdSyncCount.value += 1
            sendGuacd(syncResponse)
            if (guacdSyncCount.value === 1) {
              sendInitialMouseWakeup()
            } else if (guacdSyncCount.value <= 6) {
              sendRdpSyntheticWakeup(`sync-${guacdSyncCount.value}`, 0.5, 0.4, 80)
            }
          }
          const ackResponse = createGuacdAckResponse(instruction)
          if (ackResponse) {
            guacdAckCount.value += 1
            sendGuacd(ackResponse)
          }
        }
      } catch {
        status.value = 'error'
        errorMessage.value = t('graphicalSession.errors.protocol')
        closeSocket()
      }
      return
    }

    if (msg.type === 'graphical_gateway_input_forwarded') {
      inputForwardedCount.value = msg.count
      lastInputOpcode.value = msg.lastOpcode
      debugGraphical('gateway-input-forwarded', { count: msg.count, lastOpcode: msg.lastOpcode })
      return
    }

    if (msg.type === 'closed') {
      clearDisconnectFallback()
      clearRemoteVideoFallback()
      socketClosed.value = true
      status.value = 'closed'
      emit('session-change', null)
      restoreDisconnectScroll()
      redirectToHostsAfterDisconnect()
      return
    }

    status.value = msg.code === 'TEXT_TERMINAL_PROTOCOL' || msg.code === 'GRAPHICAL_GATEWAY_NOT_APPLICABLE'
      ? 'not-applicable'
      : 'error'
    errorMessage.value = msg.message ?? t('graphicalSession.errors.gateway')
  }

  ws.onerror = () => {
    if (ws !== currentWs) return
    status.value = 'error'
    errorMessage.value = t('graphicalSession.errors.websocket')
  }

  ws.onclose = () => {
    if (ws !== currentWs) return
    clearDisconnectFallback()
    clearRemoteVideoFallback()
    socketClosed.value = true
    if (status.value === 'disconnecting') {
      status.value = 'closed'
      emit('session-change', null)
      restoreDisconnectScroll()
      redirectToHostsAfterDisconnect()
      return
    }
    if (status.value === 'connecting') {
      status.value = 'error'
      errorMessage.value = t('graphicalSession.errors.closedBeforeReady')
    }
  }
}

async function reconnectWithSessionCredentials() {
  const currentHost = host.value
  if (!currentHost) return
  closeSocket()
  socketClosed.value = false
  await openGatewaySocket(currentHost, 'session')
}

function sendGraphicalDisconnect() {
  redirectAfterUserDisconnect = true
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    closeSocket()
    status.value = 'closed'
    socketClosed.value = true
    emit('session-change', null)
    redirectToHostsAfterDisconnect()
    return
  }

  disconnectScrollY = window.scrollY
  status.value = 'disconnecting'
  ws.send(JSON.stringify({ type: 'graphical_disconnect' }))
  clearDisconnectFallback()
  disconnectFallbackTimer = window.setTimeout(() => {
    closeSocket()
    status.value = 'closed'
    socketClosed.value = true
    emit('session-change', null)
    restoreDisconnectScroll()
    redirectToHostsAfterDisconnect()
  }, 1500)
}

async function loadSession() {
  redirectAfterUserDisconnect = false
  if (redirectAfterDisconnectTimer !== null) {
    window.clearTimeout(redirectAfterDisconnectTimer)
    redirectAfterDisconnectTimer = null
  }
  closeSocket()
  socketClosed.value = false
  gatewayMessage.value = null
  resetGuacdStats()
  errorMessage.value = null
  host.value = null
  status.value = 'loading'

  if (!hostId.value) {
    status.value = 'error'
    errorMessage.value = t('graphicalSession.errors.invalidHost')
    return
  }

  try {
    const { data } = await hostService.get(hostId.value)
    host.value = data
    const capabilities = getHostAccessProtocolCapabilities(data.accessProtocol)
    if (canOpenInWebTerminal(data.accessProtocol) || capabilities.terminalMode !== 'graphical') {
      status.value = 'not-applicable'
      return
	    }
	    await measureDisplayLayout()
	    await openGatewaySocket(data)
  } catch (err: any) {
    status.value = 'error'
    errorMessage.value = err.response?.data?.message ?? t('graphicalSession.errors.load')
  }
}

function openTextTerminal() {
  void router.push({ name: 'terminal' })
}

function backToHosts() {
  void router.push({ name: 'hosts' })
}

watch(hostId, () => { void loadSession() }, { immediate: true })
watch(status, (nextStatus) => {
  emit('status-change', nextStatus)
  if (nextStatus === 'closed') emit('remote-closed')
  if (nextStatus === 'disconnecting' || nextStatus === 'closed') return
  void nextTick(drawDisplayPlaceholder)
})
watch(() => props.visible, (visible) => {
  if (!visible) return
  void nextTick(() => {
    updateDisplaySize()
    focusCanvas()
  })
})

onMounted(() => {
  fullscreenSupported.value = document.fullscreenEnabled
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  resizeObserver = new ResizeObserver(() => {
    if (resizeDebounceTimer !== null) window.clearTimeout(resizeDebounceTimer)
    resizeDebounceTimer = window.setTimeout(updateDisplaySize, 200)
  })
  if (displayShellRef.value) resizeObserver.observe(displayShellRef.value)
  void nextTick(updateDisplaySize)
})

onBeforeUnmount(() => {
  clearPendingMouseMove()
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  clearDisconnectFallback()
  clearRemoteVideoFallback()
  if (transientMessageTimer !== null) window.clearTimeout(transientMessageTimer)
  if (redirectAfterDisconnectTimer !== null) window.clearTimeout(redirectAfterDisconnectTimer)
  if (resizeDebounceTimer !== null) window.clearTimeout(resizeDebounceTimer)
  closeSocket()
  resizeObserver?.disconnect()
})
</script>

<template>
  <main ref="sessionRootRef" :class="sessionRootClass">
    <NModal
      v-model:show="credentialsModalVisible"
      preset="card"
      title="Credenciais RDP"
      :mask-closable="false"
      :closable="false"
      style="width:min(420px, calc(100vw - 32px))"
    >
      <NAlert
        v-if="credentialsMessage"
        type="info"
        class="mb-4"
      >
        {{ credentialsMessage }}
      </NAlert>
      <NForm
        :model="rdpCredentialForm"
        label-placement="top"
        autocomplete="off"
        @submit.prevent="sendRdpSessionCredentials"
      >
        <NFormItem label="Usuário" required>
          <NInput
            v-model:value="rdpCredentialForm.username"
            autocomplete="username"
            placeholder="usuario ou DOMINIO\\usuario"
          />
        </NFormItem>
        <NFormItem label="Senha" required>
          <NInput
            v-model:value="rdpCredentialForm.password"
            type="password"
            show-password-on="mousedown"
            autocomplete="current-password"
          />
        </NFormItem>
        <NFormItem label="Domínio">
          <NInput
            v-model:value="rdpCredentialForm.domain"
            autocomplete="off"
            placeholder="Opcional"
          />
        </NFormItem>
        <div class="flex justify-end gap-2">
          <NButton @click="cancelRdpSessionCredentials">
            Cancelar
          </NButton>
          <NButton
            type="primary"
            attr-type="submit"
            :disabled="!rdpCredentialForm.username.trim() || !rdpCredentialForm.password"
          >
            Conectar
          </NButton>
        </div>
      </NForm>
    </NModal>

    <div v-show="!isFullscreen && !props.embedded" class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div class="min-w-0">
        <NTooltip trigger="hover">
          <template #trigger>
            <h1 class="truncate text-xl font-semibold text-white md:text-2xl cursor-help">
              {{ host?.name ?? $t('graphicalSession.title') }}
            </h1>
          </template>
          <div class="space-y-1 text-xs">
            <div
              v-for="row in hostTooltipRows"
              :key="row.label"
            >
              <span class="font-medium">{{ row.label }}:</span> {{ row.value }}
            </div>
          </div>
        </NTooltip>
      </div>
      <NSpace :size="8">
        <NTooltip v-if="shouldPreserveDedicatedSessionOnBack" trigger="hover">
          <template #trigger>
            <a
              :href="hostsHref"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex h-[28px] items-center justify-center rounded border border-gray-700 bg-[#2a2a30] px-3 text-sm leading-none text-gray-100 transition hover:border-gray-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {{ $t('graphicalSession.actions.backToHosts') }}
            </a>
          </template>
          {{ $t('graphicalSession.actions.backToHostsPreserveHint') }}
        </NTooltip>
        <NButton v-else size="small" @click="backToHosts">
          {{ $t('graphicalSession.actions.backToHosts') }}
        </NButton>
        <NButton
          v-if="status === 'not-applicable'"
          size="small"
          type="primary"
          @click="openTextTerminal"
        >
          {{ $t('graphicalSession.actions.openTerminal') }}
        </NButton>
        <NButton
          v-if="status === 'connected'"
          size="small"
          secondary
          @click="sendCtrlAltDel"
        >
          Ctrl+Alt+Del
        </NButton>
        <NTooltip v-if="status === 'connected'" trigger="hover">
          <template #trigger>
            <NButton
              size="small"
              secondary
              @click="sendClipboardFromBrowser"
            >
              {{ $t('graphicalSession.actions.sendClipboard') }}
            </NButton>
          </template>
          {{ $t('graphicalSession.clipboard.tooltip') }}
        </NTooltip>
        <NButton
          v-if="status === 'connected'"
          size="small"
          secondary
          :disabled="!fullscreenSupported"
          @click="toggleFullscreen"
        >
          {{ isFullscreen ? $t('graphicalSession.actions.exitFullscreen') : $t('graphicalSession.actions.enterFullscreen') }}
        </NButton>
        <NPopconfirm
          v-if="status === 'connected' || status === 'disconnecting'"
          :positive-text="$t('common.confirm')"
          :negative-text="$t('common.cancel')"
          :disabled="status === 'disconnecting'"
          @positive-click="sendGraphicalDisconnect"
        >
          <template #trigger>
            <NButton
              size="small"
              type="error"
              secondary
              :disabled="status === 'disconnecting'"
            >
              {{ $t('graphicalSession.actions.disconnect') }}
            </NButton>
          </template>
          {{ $t('graphicalSession.actions.disconnectConfirm') }}
        </NPopconfirm>
        <NButton
          size="small"
          secondary
          @click="showDetails = !showDetails"
        >
          {{ showDetails ? $t('graphicalSession.actions.hideDetails') : $t('graphicalSession.actions.showDetails') }}
        </NButton>
      </NSpace>
    </div>

    <NCard
      :content-style="isFullscreen || props.embedded ? 'padding:0;height:100%;display:flex;flex-direction:column' : 'padding:0'"
      :class="isFullscreen || props.embedded ? 'min-h-0 flex-1 overflow-hidden' : 'overflow-hidden'"
      :style="isFullscreen || props.embedded ? 'background:transparent;border:none;box-shadow:none' : ''"
    >
	      <div class="relative grid grid-cols-1" :class="sessionCanvasHostClass">
        <section
	          :class="isFullscreen
	            ? 'relative flex h-full flex-col bg-black'
	            : props.embedded
	              ? ['relative flex flex-col bg-[#111827]', sessionCanvasMinHeightClass]
	              : ['flex flex-col bg-[#111827] p-3 md:p-4', sessionCanvasMinHeightClass]"
        >
          <div
            ref="displayShellRef"
            :class="isFullscreen
              ? 'relative h-full w-full overflow-hidden bg-black'
	              : props.embedded
	                ? 'relative min-h-0 w-full flex-1 overflow-hidden bg-[#0b1220]'
	                : 'relative min-h-[360px] w-full flex-1 overflow-hidden rounded border border-gray-800 bg-[#0b1220]'"
	          >
	            <div
	              v-if="(isFullscreen || props.embedded) && (status === 'connected' || status === 'disconnecting')"
	              class="group absolute inset-x-0 top-0 z-20 h-10"
	            >
	              <div
	                class="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-3 py-2 bg-black/70 backdrop-blur-sm transition-opacity duration-150"
	                :class="isFullscreen ? 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto' : 'opacity-100'"
	              >
                <div class="flex min-w-0 items-center gap-2">
                  <NTag size="small" type="info">{{ protocolLabel }}</NTag>
                  <span class="truncate text-xs font-medium text-white">{{ host?.name }}</span>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <NButton v-if="status === 'connected'" size="small" secondary @click="sendCtrlAltDel">
                    Ctrl+Alt+Del
                  </NButton>
                  <NTooltip v-if="status === 'connected'" trigger="hover">
                    <template #trigger>
                      <NButton size="small" secondary @click="sendClipboardFromBrowser">
                        {{ $t('graphicalSession.actions.sendClipboard') }}
                      </NButton>
                    </template>
                    {{ $t('graphicalSession.clipboard.tooltip') }}
                  </NTooltip>
	                  <NButton size="small" secondary :disabled="!fullscreenSupported" @click="toggleFullscreen">
	                    {{ isFullscreen ? $t('graphicalSession.actions.exitFullscreen') : $t('graphicalSession.actions.enterFullscreen') }}
	                  </NButton>
                  <NPopconfirm
                    :positive-text="$t('common.confirm')"
                    :negative-text="$t('common.cancel')"
                    :disabled="status === 'disconnecting'"
                    @positive-click="sendGraphicalDisconnect"
                  >
                    <template #trigger>
                      <NButton size="small" type="error" secondary :disabled="status === 'disconnecting'">
                        {{ $t('graphicalSession.actions.disconnect') }}
                      </NButton>
                    </template>
                    {{ $t('graphicalSession.actions.disconnectConfirm') }}
                  </NPopconfirm>
                </div>
              </div>
            </div>
            <NSpin v-if="status === 'loading' || status === 'connecting'" size="large" />
            <div
              v-if="!isFullscreen && transientMessage"
              class="pointer-events-none absolute left-1/2 top-3 z-30 max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 rounded border border-gray-700 bg-black/75 px-3 py-2 text-center text-xs text-gray-100 shadow-lg backdrop-blur"
            >
              {{ transientMessage }}
            </div>
            <canvas
              ref="canvasRef"
              class="absolute touch-none select-none outline-none focus:ring-2 focus:ring-emerald-500"
              tabindex="0"
              role="img"
              :aria-label="$t('graphicalSession.displayLabel')"
              @pointerdown="handleCanvasPointerDown"
              @pointerup="handleCanvasPointerUp"
              @pointermove="handleCanvasPointerMove"
              @wheel="handleCanvasWheel"
              @contextmenu.prevent
              @keydown="handleCanvasKey($event, true)"
              @keyup="handleCanvasKey($event, false)"
              @paste="handleCanvasPaste"
            />
          </div>

	          <div
	            v-if="!isFullscreen && (status === 'pending' || status === 'not-applicable' || status === 'error')"
            class="mx-auto mt-4 w-full max-w-xl text-center"
	          >
            <h2 class="mt-6 text-lg font-semibold text-white">
              {{ status === 'pending' ? $t('graphicalSession.pendingTitle') : statusLabel }}
            </h2>
            <p class="mt-2 text-sm leading-6 text-gray-400">
              {{ status === 'pending'
                ? $t('graphicalSession.pendingDescription', { protocol: protocolLabel })
                : $t('graphicalSession.waitDescription') }}
            </p>

            <NAlert
              v-if="status === 'error' || status === 'not-applicable'"
              class="mt-5 text-left"
              :type="status === 'not-applicable' ? 'warning' : 'error'"
              :bordered="false"
            >
              {{ errorMessage ?? $t('graphicalSession.errors.notApplicable') }}
            </NAlert>
            <NButton
              v-if="remoteVideoCredentialFallback"
              class="mt-4"
              size="small"
              type="primary"
              secondary
              @click="reconnectWithSessionCredentials"
            >
              {{ $t('graphicalSession.actions.reconnectWithCredentials') }}
            </NButton>
          </div>
        </section>

        <aside
          v-if="showDetails"
          class="absolute bottom-4 right-4 top-4 z-10 w-[min(360px,calc(100%-32px))] overflow-auto rounded border border-gray-800 bg-[#171923]/95 p-4 shadow-2xl backdrop-blur"
        >
          <h2 class="text-sm font-semibold text-white">{{ $t('graphicalSession.details.title') }}</h2>
          <NDescriptions
            class="mt-4"
            label-placement="top"
            :column="1"
            size="small"
            bordered
          >
            <NDescriptionsItem :label="$t('common.name')">
              {{ host?.name ?? '-' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('common.ip')">
              <span class="font-mono">{{ host ? `${host.ip}:${host.port}` : '-' }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('common.type')">
              {{ protocolLabel }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('common.status')">
              {{ statusLabel }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.sessionId')">
              <span class="font-mono">{{ gatewayMessage?.sessionId ?? '-' }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.connectionMethod')">
              {{ connectionMethodLabel }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.gatewayMessage')">
              {{ gatewayMessage?.message ?? '-' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.remoteVideoMessage')">
              {{ remoteVideoMessage ?? '-' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.clipboardMessage')">
              {{ clipboardMessage ?? '-' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.gatewayFrames')">
              <span class="font-mono">{{ guacdFrameCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.gatewayInstructions')">
              <span class="font-mono">{{ guacdInstructionCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.lastOpcode')">
              <span class="font-mono">{{ lastGuacdOpcode ?? '-' }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.opcodeSummary')">
              <span class="font-mono text-xs">{{ opcodeSummary }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.syncResponses')">
              <span class="font-mono">{{ guacdSyncCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.ackResponses')">
              <span class="font-mono">{{ guacdAckCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.renderCommands')">
              <span class="font-mono">{{ guacdRenderCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.renderedOpcodeSummary')">
              <span class="font-mono text-xs">{{ renderedOpcodeSummary }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.unknownDisplayOpcodes')">
              <span class="font-mono text-xs">{{ unknownDisplayOpcodeSummary }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.layerSummary')">
              <span class="font-mono text-xs">{{ layerSummary }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.remoteResolution')">
              <span class="font-mono">{{ displayWidth }}x{{ displayHeight }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.viewportResolution')">
              <span class="font-mono">{{ viewportWidth }}x{{ viewportHeight }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.imageRenderErrors')">
              <span class="font-mono">{{ imageRenderErrorCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.inputEvents')">
              <span class="font-mono">{{ inputEventCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.inputSends')">
              <span class="font-mono">{{ inputSendCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.inputForwards')">
              <span class="font-mono">{{ inputForwardedCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.lastInputOpcode')">
              <span class="font-mono">{{ lastInputOpcode ?? '-' }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.lastInputInstruction')">
              <span class="font-mono text-xs">{{ lastInputInstruction ?? '-' }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.clipboardSends')">
              <span class="font-mono">{{ clipboardSendCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.clipboardReceives')">
              <span class="font-mono">{{ clipboardReceiveCount }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('graphicalSession.details.gatewayBytes')">
              <span class="font-mono">{{ guacdByteCount }}</span>
            </NDescriptionsItem>
          </NDescriptions>

          <NText depth="3" class="mt-4 block text-xs leading-5">
            {{ $t('graphicalSession.details.note') }}
          </NText>
        </aside>
      </div>
    </NCard>
  </main>
</template>
