<script setup lang="ts">
import { computed } from 'vue'
import type { HostOperatingSystem } from '@nodeaccess/shared'

const props = withDefaults(defineProps<{
  operatingSystem: HostOperatingSystem
  label: string
  size?: 'list' | 'card'
}>(), {
  size: 'list',
})

const normalized = computed(() => props.operatingSystem)

const fallbackLabel = computed(() => {
  const labels: Record<HostOperatingSystem, string> = {
    unknown: '?',
    linux: 'L',
    ubuntu: 'U',
    debian: 'D',
    centos: 'C',
    rhel: 'RH',
    rocky: 'R',
    almalinux: 'A',
    suse: 'S',
    windows: 'W',
    windows_server: 'WS',
    macos: 'M',
    freebsd: 'B',
    other: '*',
  }
  return labels[normalized.value]
})

const iconClass = computed(() => [
  'host-os-icon',
  `host-os-icon--${props.size}`,
  `host-os-icon--${normalized.value}`,
])

const showUbuntu = computed(() => normalized.value === 'ubuntu')
const showDebian = computed(() => normalized.value === 'debian')
const showWindows = computed(() => normalized.value === 'windows' || normalized.value === 'windows_server')
const showMacos = computed(() => normalized.value === 'macos')
const showLinux = computed(() => normalized.value === 'linux')
const showRhel = computed(() => normalized.value === 'rhel')
const showRocky = computed(() => normalized.value === 'rocky')
const showAlmaLinux = computed(() => normalized.value === 'almalinux')
const showCentos = computed(() => normalized.value === 'centos')
const showSuse = computed(() => normalized.value === 'suse')
</script>

<template>
  <span :class="iconClass" :aria-label="label" :title="label" role="img">
    <svg v-if="showUbuntu" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.18" />
      <circle cx="12" cy="12" r="5.1" fill="none" stroke="currentColor" stroke-width="2.1" />
      <circle cx="12" cy="4.4" r="2.1" fill="currentColor" />
      <circle cx="5.4" cy="15.8" r="2.1" fill="currentColor" />
      <circle cx="18.6" cy="15.8" r="2.1" fill="currentColor" />
      <path d="M9.6 7.6 8.2 5.2M8.1 14.2 5.7 15.1M15.9 14.2l2.4.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <svg v-else-if="showDebian" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.7 7.2c-1.7-1.3-4.9-1.2-6.8.5-2.4 2.1-1.9 5.7.7 7.2 2.3 1.3 5.5.6 6.4-1.5.7-1.5-.3-3.1-1.9-3.4-1.4-.2-2.7.6-2.8 1.7-.1.9.6 1.5 1.5 1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      <path d="M16.1 7.6c1.4 1.1 2.2 2.7 2 4.6-.4 4.2-5.6 6.8-10 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.7" />
    </svg>
    <svg v-else-if="showWindows" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 5.3 10.2 4v7.3H3.5V5.3Zm8.4-1.6 8.6-1.6v9.2h-8.6V3.7ZM3.5 12.7h6.7V20l-6.7-1.2v-6.1Zm8.4 0h8.6v9.2l-8.6-1.6v-7.6Z" fill="currentColor" />
    </svg>
    <svg v-else-if="showMacos" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.2 3.2c-.2 1.3-.8 2.3-1.7 3-.8.7-1.7 1-2.8.9.1-1.2.7-2.2 1.6-3 .9-.7 1.9-1 2.9-.9Z" fill="currentColor" />
      <path d="M18.7 16.8c-.5 1.1-.8 1.6-1.5 2.6-1 1.5-2.4 3.3-4.1 3.3-1.5 0-1.9-1-3.9-1-2.1 0-2.5 1-3.9 1-1.7 0-3-1.7-4-3.2-2.8-4.3-3.1-9.4-1.4-12.1 1.2-1.9 3.1-3 4.9-3 1.8 0 2.9 1 4.4 1 1.4 0 2.3-1 4.4-1 1.6 0 3.3.9 4.5 2.4-4 2.2-3.3 7.9.6 9Z" fill="currentColor" transform="translate(2 0) scale(.86)" />
    </svg>
    <svg v-else-if="showLinux" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2c2.4 0 4.1 2.3 4.1 5.5 0 1.6.8 2.8 1.7 4.2.7 1.1 1.2 2.2 1.2 3.8 0 2.9-2.9 4.3-7 4.3s-7-1.4-7-4.3c0-1.6.5-2.7 1.2-3.8.9-1.4 1.7-2.6 1.7-4.2 0-3.2 1.7-5.5 4.1-5.5Z" fill="currentColor" opacity="0.95" />
      <circle cx="10.1" cy="8.4" r="0.8" fill="#111113" />
      <circle cx="13.9" cy="8.4" r="0.8" fill="#111113" />
      <path d="M10.3 11.2h3.4L12 13.2l-1.7-2Z" fill="#111113" />
    </svg>
    <svg v-else-if="showRhel" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.4 13.7c.3-2.9 2.2-5 5.2-5.8l1.1-3.1c.2-.6.8-.9 1.4-.7l5 1.4c.5.1.9.5 1 1l.8 3.5c1.1.8 1.8 1.8 1.8 3 0 3.1-3.7 5.6-8.3 5.6-3.4 0-6.4-1.2-8-3.1-.4-.5-.2-1.2.4-1.8Z" fill="currentColor" />
      <path d="M6.6 13.8c1.7 1.2 4 1.8 6.5 1.8 2.2 0 4.1-.5 5.4-1.4" fill="none" stroke="#111113" stroke-width="1.6" stroke-linecap="round" opacity="0.85" />
    </svg>
    <svg v-else-if="showRocky" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 21.2 12 12 21.2 2.8 12 12 2.8Z" fill="currentColor" opacity="0.24" />
      <path d="M5.2 14.8 10 8.6l2.2 3 2.6-4.1 4.3 7.3H5.2Z" fill="currentColor" />
      <path d="M8.1 14.8h10.7L12 21.2 5.2 14.8h2.9Z" fill="currentColor" opacity="0.55" />
    </svg>
    <svg v-else-if="showAlmaLinux" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" fill="currentColor" opacity="0.18" />
      <path d="M12 4.4c2.5 1.7 3.7 3.9 3.4 6.2-.3 2.5-1.9 4.5-3.4 6.1-1.5-1.6-3.1-3.6-3.4-6.1-.3-2.3.9-4.5 3.4-6.2Z" fill="currentColor" />
      <path d="M6.5 9.7c2.4-.3 4.2.5 5.5 2.3-1.8 1-3.9 1.2-5.6.2-1.2-.7-1.3-1.8.1-2.5Zm11 0c-2.4-.3-4.2.5-5.5 2.3 1.8 1 3.9 1.2 5.6.2 1.2-.7 1.3-1.8-.1-2.5Z" fill="currentColor" opacity="0.72" />
    </svg>
    <svg v-else-if="showCentos" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.1 3.5h3.8v6.6h6.6v3.8h-6.6v6.6h-3.8v-6.6H3.5v-3.8h6.6V3.5Z" fill="currentColor" />
      <path d="M5.8 5.8h4.3v4.3H5.8V5.8Zm8.1 0h4.3v4.3h-4.3V5.8ZM5.8 13.9h4.3v4.3H5.8v-4.3Zm8.1 0h4.3v4.3h-4.3v-4.3Z" fill="#111113" opacity="0.62" />
    </svg>
    <svg v-else-if="showSuse" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.4 11.5c0 4.2-3.8 7-8.3 7-4.2 0-7.6-2.3-7.6-5.8 0-3.8 3.7-6.9 8.1-6.9 2.5 0 4.8.9 6.2 2.4l1.7-1.1v4.4Z" fill="currentColor" />
      <circle cx="14.6" cy="10.8" r="3.3" fill="#111113" opacity="0.68" />
      <circle cx="14.6" cy="10.8" r="1.4" fill="currentColor" />
      <path d="M6.9 13.2c1.3 1.2 3.2 1.8 5.1 1.8" fill="none" stroke="#111113" stroke-width="1.5" stroke-linecap="round" opacity="0.7" />
    </svg>
    <span v-else>{{ fallbackLabel }}</span>
  </span>
</template>

<style scoped>
.host-os-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  color: #d4d4d8;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
  user-select: none;
}

.host-os-icon--list {
  width: 22px;
  height: 22px;
  font-size: 10px;
}

.host-os-icon--card {
  width: 26px;
  height: 26px;
  font-size: 11px;
}

.host-os-icon svg {
  width: 82%;
  height: 82%;
  display: block;
}

.host-os-icon--ubuntu { background: #2d1712; border-color: rgba(221, 72, 20, 0.62); color: #e95420; }
.host-os-icon--debian { background: rgba(215, 10, 83, 0.14); border-color: rgba(215, 10, 83, 0.42); color: #d70a53; }
.host-os-icon--windows,
.host-os-icon--windows_server { background: rgba(0, 120, 215, 0.16); border-color: rgba(0, 120, 215, 0.46); color: #4aa3ff; }
.host-os-icon--macos { background: rgba(161, 161, 170, 0.14); border-color: rgba(212, 212, 216, 0.36); color: #f4f4f5; }
.host-os-icon--linux { background: rgba(250, 204, 21, 0.15); border-color: rgba(250, 204, 21, 0.42); color: #facc15; }
.host-os-icon--centos,
.host-os-icon--rhel,
.host-os-icon--rocky,
.host-os-icon--almalinux { background: rgba(34, 197, 94, 0.14); border-color: rgba(34, 197, 94, 0.36); color: #86efac; }
.host-os-icon--suse { background: rgba(13, 148, 136, 0.16); border-color: rgba(13, 148, 136, 0.38); color: #5eead4; }
.host-os-icon--freebsd { background: rgba(239, 68, 68, 0.16); border-color: rgba(239, 68, 68, 0.40); color: #fca5a5; }
.host-os-icon--other { background: rgba(168, 85, 247, 0.14); border-color: rgba(168, 85, 247, 0.36); color: #d8b4fe; }
</style>
