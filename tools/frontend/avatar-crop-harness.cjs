#!/usr/bin/env node
/*
 * Avatar crop/upload regression harness.
 *
 * Static by design: the runtime image pipeline depends on browser canvas, while
 * the crop math is covered by Vitest in avatar-image-processing.test.ts.
 *
 * Usage:
 *   node tools/frontend/avatar-crop-harness.cjs
 */

const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const PROFILE_PATH = path.join(REPO_ROOT, 'apps/frontend/src/views/ProfileView.vue')
const MODAL_PATH = path.join(REPO_ROOT, 'apps/frontend/src/components/AvatarCropModal.vue')
const PROCESSING_PATH = path.join(REPO_ROOT, 'apps/frontend/src/services/avatar-image-processing.ts')
const PT_BR_PATH = path.join(REPO_ROOT, 'apps/frontend/src/locales/pt-BR.json')
const EN_PATH = path.join(REPO_ROOT, 'apps/frontend/src/locales/en.json')

const profile = fs.readFileSync(PROFILE_PATH, 'utf8')
const modal = fs.readFileSync(MODAL_PATH, 'utf8')
const processing = fs.readFileSync(PROCESSING_PATH, 'utf8')
const ptBr = JSON.parse(fs.readFileSync(PT_BR_PATH, 'utf8'))
const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'))

const findings = []

const profileMarkers = [
  ['component import', "import AvatarCropModal from '@/components/AvatarCropModal.vue'"],
  ['type guard', 'isAcceptedAvatarType(file.type)'],
  ['source size guard', 'AVATAR_MAX_SOURCE_BYTES'],
  ['selected file state', 'selectedAvatarFile'],
  ['modal show state', 'showAvatarCrop'],
  ['modal usage', '<AvatarCropModal'],
  ['confirm handler', '@confirm="confirmAvatarCrop"'],
  ['api receives processed file', 'userService.updateOwnAvatar(file)'],
]
for (const [name, marker] of profileMarkers) {
  if (!profile.includes(marker)) findings.push(`ProfileView sem marcador de ${name}: ${marker}`)
}

if (/file\.size\s*>\s*512\s*\*\s*1024/.test(profile)) {
  findings.push('ProfileView voltou a bloquear 512 KB antes do crop/compressao.')
}

const modalMarkers = [
  ['modal root', 'data-avatar-crop-modal="true"'],
  ['circular preview', 'data-avatar-crop-preview="true"'],
  ['zoom control', 'data-avatar-crop-zoom="true"'],
  ['reset action', 'data-avatar-crop-action="reset"'],
  ['confirm action', 'data-avatar-crop-action="confirm"'],
  ['pointer drag', '@pointerdown="onPointerDown"'],
  ['render helper', 'renderAvatarFile(imageEl.value'],
  ['preview circle', 'border-radius: 999px'],
  ['visible contour', '0 0 0 2px #60a5fa'],
]
for (const [name, marker] of modalMarkers) {
  if (!modal.includes(marker)) findings.push(`AvatarCropModal sem marcador de ${name}: ${marker}`)
}

const processingMarkers = [
  ['output size', 'AVATAR_OUTPUT_SIZE = 320'],
  ['backend upload limit', 'AVATAR_MAX_UPLOAD_BYTES = 512 * 1024'],
  ['large source limit', 'AVATAR_MAX_SOURCE_BYTES = 15 * 1024 * 1024'],
  ['accepted types', 'AVATAR_ACCEPTED_TYPES'],
  ['canvas rendering', "document.createElement('canvas')"],
  ['high quality smoothing', "ctx.imageSmoothingQuality = 'high'"],
  ['webp output', "mimeType ?? 'image/webp'"],
  ['quality loop', 'const qualities = [0.9'],
  ['jpeg fallback', "mimeType === 'image/webp'"],
  ['offset clamp', 'clampAvatarOffset'],
]
for (const [name, marker] of processingMarkers) {
  if (!processing.includes(marker)) findings.push(`avatar-image-processing sem marcador de ${name}: ${marker}`)
}

for (const [localeName, locale] of [['pt-BR', ptBr], ['en', en]]) {
  const crop = locale.profile?.avatar?.crop
  if (!crop) {
    findings.push(`${localeName}: profile.avatar.crop ausente`)
    continue
  }
  for (const key of ['title', 'previewLabel', 'outputHint', 'zoom', 'dragHint', 'reset', 'apply', 'loadError', 'processError']) {
    if (!crop[key]) findings.push(`${localeName}: profile.avatar.crop.${key} ausente`)
  }
  if (!locale.profile?.avatar?.invalidType) findings.push(`${localeName}: profile.avatar.invalidType ausente`)
  if (!locale.profile?.avatar?.sourceFileTooLarge) findings.push(`${localeName}: profile.avatar.sourceFileTooLarge ausente`)
}

const report = {
  ok: findings.length === 0,
  sourcePaths: {
    profile: PROFILE_PATH,
    modal: MODAL_PATH,
    processing: PROCESSING_PATH,
    ptBr: PT_BR_PATH,
    en: EN_PATH,
  },
  findings,
  checks: {
    profileMarkers: profileMarkers.map(([name, marker]) => ({ name, present: profile.includes(marker) })),
    modalMarkers: modalMarkers.map(([name, marker]) => ({ name, present: modal.includes(marker) })),
    processingMarkers: processingMarkers.map(([name, marker]) => ({ name, present: processing.includes(marker) })),
  },
}

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(1)
