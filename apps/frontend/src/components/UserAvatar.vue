<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import api from '@/services/api'

interface AvatarUser {
  id?: number | null
  name?: string | null
  email?: string | null
  avatarUrl?: string | null
}

const props = withDefaults(defineProps<{
  user?: AvatarUser | null
  size?: number
  showStatusRing?: boolean
}>(), {
  user: null,
  size: 32,
  showStatusRing: false,
})

const imageFailed = ref(false)
const authenticatedImageUrl = ref<string | null>(null)
let avatarLoadId = 0

const displayName = computed(() => props.user?.name?.trim() || props.user?.email?.trim() || 'Usuario')
const initials = computed(() => {
  const parts = displayName.value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const first = parts[0]?.[0] ?? 'U'
  const last = parts.length > 1 ? parts.at(-1)?.[0] : parts[0]?.[1]
  return `${first}${last ?? ''}`.toUpperCase()
})

const avatarSeed = computed(() => `${props.user?.id ?? ''}:${displayName.value}:${props.user?.email ?? ''}`)
const avatarIndex = computed(() => {
  let hash = 0
  for (let i = 0; i < avatarSeed.value.length; i++) {
    hash = ((hash << 5) - hash) + avatarSeed.value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 8
})

const motif = computed(() => ['$_', '{}', '#!', '01', '</>', 'ops', 'ssh', '~/'][avatarIndex.value])
const hasImage = computed(() => !!authenticatedImageUrl.value && !imageFailed.value)
const dimensionStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.max(10, Math.floor(props.size * 0.32))}px`,
}))

function revokeAuthenticatedImageUrl() {
  if (!authenticatedImageUrl.value) return
  URL.revokeObjectURL(authenticatedImageUrl.value)
  authenticatedImageUrl.value = null
}

function avatarApiUrl(url: string): string {
  return url.startsWith('/api/v1/') ? url.slice('/api/v1'.length) : url
}

watch(() => props.user?.avatarUrl, async (url) => {
  const loadId = ++avatarLoadId
  imageFailed.value = false
  revokeAuthenticatedImageUrl()
  if (!url) return

  try {
    const { data } = await api.get<Blob>(avatarApiUrl(url), { responseType: 'blob' })
    if (loadId !== avatarLoadId) return
    authenticatedImageUrl.value = URL.createObjectURL(data)
  } catch {
    if (loadId === avatarLoadId) imageFailed.value = true
  }
}, { immediate: true })

onUnmounted(() => {
  avatarLoadId++
  revokeAuthenticatedImageUrl()
})
</script>

<template>
  <span
    class="user-avatar"
    :class="[`user-avatar--${avatarIndex}`, { 'user-avatar--ring': showStatusRing }]"
    :style="dimensionStyle"
    :aria-label="displayName"
  >
    <img
      v-if="hasImage"
      :src="authenticatedImageUrl || ''"
      :alt="displayName"
      loading="lazy"
      decoding="async"
      @error="imageFailed = true"
    >
    <span v-else class="user-avatar__fallback">
      <span class="user-avatar__motif">{{ motif }}</span>
      <span class="user-avatar__initials">{{ initials }}</span>
    </span>
  </span>
</template>

<style scoped>
.user-avatar {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: #1f2937;
  color: #fff;
  font-weight: 700;
  line-height: 1;
}

.user-avatar--ring {
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.28);
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-avatar__fallback {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}

.user-avatar__motif {
  position: absolute;
  right: 2px;
  bottom: 2px;
  opacity: 0.34;
  font-size: 0.64em;
  font-weight: 800;
}

.user-avatar__initials {
  position: relative;
  z-index: 1;
  letter-spacing: 0;
}

.user-avatar--0 { background: linear-gradient(135deg, #0f766e, #2563eb); }
.user-avatar--1 { background: linear-gradient(135deg, #7c2d12, #be123c); }
.user-avatar--2 { background: linear-gradient(135deg, #1d4ed8, #4338ca); }
.user-avatar--3 { background: linear-gradient(135deg, #166534, #0891b2); }
.user-avatar--4 { background: linear-gradient(135deg, #6d28d9, #db2777); }
.user-avatar--5 { background: linear-gradient(135deg, #374151, #0284c7); }
.user-avatar--6 { background: linear-gradient(135deg, #854d0e, #4d7c0f); }
.user-avatar--7 { background: linear-gradient(135deg, #0f172a, #9333ea); }
</style>
