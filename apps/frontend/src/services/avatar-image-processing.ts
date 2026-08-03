export const AVATAR_OUTPUT_SIZE = 320
export const AVATAR_MAX_UPLOAD_BYTES = 512 * 1024
export const AVATAR_MAX_SOURCE_BYTES = 15 * 1024 * 1024
export const AVATAR_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export interface AvatarCropState {
  naturalWidth: number
  naturalHeight: number
  previewSize: number
  zoom: number
  offsetX: number
  offsetY: number
}

export interface AvatarRenderOptions extends AvatarCropState {
  outputSize?: number
  maxBytes?: number
  mimeType?: 'image/webp' | 'image/jpeg'
  fileName?: string
}

export function isAcceptedAvatarType(type: string): boolean {
  return AVATAR_ACCEPTED_TYPES.includes(type as (typeof AVATAR_ACCEPTED_TYPES)[number])
}

export function centeredAvatarOffset(
  naturalWidth: number,
  naturalHeight: number,
  previewSize: number,
  zoom: number,
) {
  const scale = avatarPreviewScale(naturalWidth, naturalHeight, previewSize, zoom)
  return {
    x: (previewSize - naturalWidth * scale) / 2,
    y: (previewSize - naturalHeight * scale) / 2,
    scale,
  }
}

export function avatarPreviewScale(
  naturalWidth: number,
  naturalHeight: number,
  previewSize: number,
  zoom: number,
) {
  const baseScale = Math.max(previewSize / naturalWidth, previewSize / naturalHeight)
  return baseScale * zoom
}

export function clampAvatarOffset(state: AvatarCropState) {
  const scale = avatarPreviewScale(state.naturalWidth, state.naturalHeight, state.previewSize, state.zoom)
  const scaledWidth = state.naturalWidth * scale
  const scaledHeight = state.naturalHeight * scale
  const maxX = Math.max(0, (scaledWidth - state.previewSize) / 2)
  const maxY = Math.max(0, (scaledHeight - state.previewSize) / 2)
  return {
    offsetX: clamp(state.offsetX, -maxX, maxX),
    offsetY: clamp(state.offsetY, -maxY, maxY),
    scaledWidth,
    scaledHeight,
  }
}

export function avatarImageStyle(state: AvatarCropState) {
  const scale = avatarPreviewScale(state.naturalWidth, state.naturalHeight, state.previewSize, state.zoom)
  const centered = centeredAvatarOffset(state.naturalWidth, state.naturalHeight, state.previewSize, state.zoom)
  const clamped = clampAvatarOffset(state)
  return {
    width: `${state.naturalWidth * scale}px`,
    height: `${state.naturalHeight * scale}px`,
    transform: `translate(${centered.x + clamped.offsetX}px, ${centered.y + clamped.offsetY}px)`,
  }
}

export async function renderAvatarFile(
  image: CanvasImageSource,
  options: AvatarRenderOptions,
): Promise<File> {
  const outputSize = options.outputSize ?? AVATAR_OUTPUT_SIZE
  const maxBytes = options.maxBytes ?? AVATAR_MAX_UPLOAD_BYTES
  const mimeType = options.mimeType ?? 'image/webp'
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível para processar avatar')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const baseScale = Math.max(outputSize / options.naturalWidth, outputSize / options.naturalHeight)
  const scale = baseScale * options.zoom
  const previewToOutput = outputSize / options.previewSize
  const clamped = clampAvatarOffset(options)
  const dx = (outputSize - options.naturalWidth * scale) / 2 + clamped.offsetX * previewToOutput
  const dy = (outputSize - options.naturalHeight * scale) / 2 + clamped.offsetY * previewToOutput

  ctx.clearRect(0, 0, outputSize, outputSize)
  ctx.drawImage(image, dx, dy, options.naturalWidth * scale, options.naturalHeight * scale)

  const qualities = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42]
  let best: Blob | null = null
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, mimeType, quality)
    best = blob
    if (blob.size <= maxBytes) {
      return new File([blob], normalizeAvatarFileName(options.fileName, mimeType), { type: mimeType })
    }
  }

  if (best && best.size <= maxBytes) {
    return new File([best], normalizeAvatarFileName(options.fileName, mimeType), { type: mimeType })
  }

  if (mimeType === 'image/webp') {
    return renderAvatarFile(image, { ...options, mimeType: 'image/jpeg' })
  }

  throw new Error('A foto processada ainda ficou acima do limite permitido')
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Falha ao gerar imagem do avatar'))
    }, type, quality)
  })
}

function normalizeAvatarFileName(fileName: string | undefined, mimeType: string) {
  const extension = mimeType === 'image/webp' ? 'webp' : 'jpg'
  const base = (fileName || 'avatar')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'avatar'
  return `${base}.${extension}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
