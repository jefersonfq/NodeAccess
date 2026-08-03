<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { NAlert, NButton, NModal, NSlider, NText, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  AVATAR_OUTPUT_SIZE,
  avatarImageStyle,
  clampAvatarOffset,
  renderAvatarFile,
  type AvatarCropState,
} from '@/services/avatar-image-processing'

const PREVIEW_SIZE = 260

const props = defineProps<{
  show: boolean
  file: File | null
}>()

const emit = defineEmits<{
  close: []
  confirm: [file: File]
}>()

const { t } = useI18n()
const message = useMessage()
const imageEl = ref<HTMLImageElement | null>(null)
const objectUrl = ref<string | null>(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)
const zoom = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const processing = ref(false)
const loadError = ref<string | null>(null)
const dragStart = ref<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null)

const cropReady = computed(() => !!objectUrl.value && naturalWidth.value > 0 && naturalHeight.value > 0)
const cropState = computed<AvatarCropState>(() => ({
  naturalWidth: naturalWidth.value,
  naturalHeight: naturalHeight.value,
  previewSize: PREVIEW_SIZE,
  zoom: zoom.value,
  offsetX: offsetX.value,
  offsetY: offsetY.value,
}))
const previewImageStyle = computed(() => cropReady.value ? avatarImageStyle(cropState.value) : {})
const originalSizeLabel = computed(() => {
  const size = props.file?.size ?? 0
  if (size <= 0) return ''
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
})

watch(() => props.file, (file) => {
  resetObjectUrl()
  resetCrop()
  loadError.value = null
  if (!file) return
  objectUrl.value = URL.createObjectURL(file)
}, { immediate: true })

watch(zoom, () => applyClamp())

onBeforeUnmount(() => {
  resetObjectUrl()
  detachPointerListeners()
})

function resetObjectUrl() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = null
}

function resetCrop() {
  naturalWidth.value = 0
  naturalHeight.value = 0
  zoom.value = 1
  offsetX.value = 0
  offsetY.value = 0
  dragStart.value = null
}

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement
  naturalWidth.value = image.naturalWidth
  naturalHeight.value = image.naturalHeight
  zoom.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

function onImageError() {
  loadError.value = t('profile.avatar.crop.loadError')
}

function applyClamp() {
  if (!cropReady.value) return
  const clamped = clampAvatarOffset(cropState.value)
  offsetX.value = clamped.offsetX
  offsetY.value = clamped.offsetY
}

function resetPosition() {
  zoom.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

function onPointerDown(event: PointerEvent) {
  if (!cropReady.value || processing.value) return
  event.preventDefault()
  dragStart.value = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    offsetX: offsetX.value,
    offsetY: offsetY.value,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent) {
  const start = dragStart.value
  if (!start || event.pointerId !== start.pointerId) return
  offsetX.value = start.offsetX + event.clientX - start.x
  offsetY.value = start.offsetY + event.clientY - start.y
  applyClamp()
}

function onPointerUp(event: PointerEvent) {
  const start = dragStart.value
  if (start && event.pointerId !== start.pointerId) return
  dragStart.value = null
  detachPointerListeners()
}

function detachPointerListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

async function confirmCrop() {
  if (!props.file || !imageEl.value || !cropReady.value) return
  processing.value = true
  try {
    await nextTick()
    const file = await renderAvatarFile(imageEl.value, {
      ...cropState.value,
      outputSize: AVATAR_OUTPUT_SIZE,
      fileName: props.file.name,
    })
    emit('confirm', file)
  } catch (error) {
    const fallback = error instanceof Error ? error.message : t('profile.avatar.crop.processError')
    message.error(fallback)
  } finally {
    processing.value = false
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="$t('profile.avatar.crop.title')"
    class="avatar-crop-modal"
    :mask-closable="!processing"
    @update:show="(value) => { if (!value && !processing) emit('close') }"
  >
    <div class="avatar-crop" data-avatar-crop-modal="true">
      <div class="avatar-crop__workspace">
        <div
          class="avatar-crop__preview"
          :style="{ width: `${PREVIEW_SIZE}px`, height: `${PREVIEW_SIZE}px` }"
          data-avatar-crop-preview="true"
          role="img"
          :aria-label="$t('profile.avatar.crop.previewLabel')"
          @pointerdown="onPointerDown"
        >
          <img
            v-if="objectUrl"
            ref="imageEl"
            :src="objectUrl"
            alt=""
            class="avatar-crop__image"
            :style="previewImageStyle"
            draggable="false"
            @load="onImageLoad"
            @error="onImageError"
          >
          <div class="avatar-crop__mask" />
        </div>

        <div class="avatar-crop__meta">
          <NText strong>{{ props.file?.name }}</NText>
          <NText depth="3" class="text-xs">
            {{ $t('profile.avatar.crop.outputHint', { size: AVATAR_OUTPUT_SIZE, original: originalSizeLabel }) }}
          </NText>
        </div>
      </div>

      <NAlert v-if="loadError" type="error" :bordered="false">
        {{ loadError }}
      </NAlert>

      <div class="avatar-crop__controls">
        <div class="avatar-crop__control-row">
          <NText class="avatar-crop__label">{{ $t('profile.avatar.crop.zoom') }}</NText>
          <NSlider
            v-model:value="zoom"
            :min="1"
            :max="4"
            :step="0.01"
            :disabled="!cropReady || processing"
            data-avatar-crop-zoom="true"
          />
        </div>
        <div class="avatar-crop__hint">
          {{ $t('profile.avatar.crop.dragHint') }}
        </div>
      </div>

      <div class="avatar-crop__actions">
        <NButton secondary :disabled="processing" data-avatar-crop-action="reset" @click="resetPosition">
          {{ $t('profile.avatar.crop.reset') }}
        </NButton>
        <div class="avatar-crop__spacer" />
        <NButton :disabled="processing" data-avatar-crop-action="cancel" @click="emit('close')">
          {{ $t('common.cancel') }}
        </NButton>
        <NButton
          type="primary"
          :loading="processing"
          :disabled="!cropReady || !!loadError"
          data-avatar-crop-action="confirm"
          @click="confirmCrop"
        >
          {{ $t('profile.avatar.crop.apply') }}
        </NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.avatar-crop-modal {
  width: min(520px, calc(100vw - 32px));
}

.avatar-crop {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.avatar-crop__workspace {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 18px;
  align-items: center;
}

.avatar-crop__preview {
  position: relative;
  overflow: hidden;
  flex: none;
  border-radius: 999px;
  background: #0b0f16;
  cursor: grab;
  touch-action: none;
  box-shadow:
    0 0 0 2px #60a5fa,
    0 0 0 7px rgba(96, 165, 250, 0.14),
    inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.avatar-crop__preview:active {
  cursor: grabbing;
}

.avatar-crop__image {
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  user-select: none;
  pointer-events: none;
  transform-origin: top left;
}

.avatar-crop__mask {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
}

.avatar-crop__meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.avatar-crop__controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.avatar-crop__control-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.avatar-crop__label {
  font-size: 12px;
}

.avatar-crop__hint {
  color: #9ca3af;
  font-size: 12px;
}

.avatar-crop__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.avatar-crop__spacer {
  flex: 1;
}

@media (max-width: 540px) {
  .avatar-crop__workspace {
    grid-template-columns: 1fr;
    justify-items: center;
  }

  .avatar-crop__meta {
    width: 100%;
    text-align: center;
  }
}
</style>
