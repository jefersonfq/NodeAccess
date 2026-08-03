<script setup lang="ts">
import { computed } from 'vue'
import { NPopover, NTag, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { AccessMapHost, AccessMapSession } from '@/services/sessions.service'
import UserAvatar from '@/components/UserAvatar.vue'

const props = defineProps<{
  presence: AccessMapHost
  compact?: boolean
}>()

const { t } = useI18n()

interface PresenceUser {
  id: number
  name: string
  email: string
  avatarUrl: string | null
  avatarVersion: string | null
  sessions: AccessMapSession[]
}

const users = computed<PresenceUser[]>(() => {
  const byUser = new Map<number, PresenceUser>()
  for (const session of props.presence.sessions) {
    const existing = byUser.get(session.user.id)
    if (existing) {
      existing.sessions.push(session)
      continue
    }
    byUser.set(session.user.id, {
      ...session.user,
      sessions: [session],
    })
  }
  return Array.from(byUser.values()).sort((a, b) => a.name.localeCompare(b.name))
})

const visibleUsers = computed(() => users.value.slice(0, 3))
const hiddenUserCount = computed(() => Math.max(0, users.value.length - visibleUsers.value.length))
const summaryLabel = computed(() => t('hosts.presence.summary', {
  users: props.presence.uniqueUsers,
  sessions: props.presence.activeSessions,
}))
const compactLabel = computed(() => t('hosts.presence.usersShort', {
  count: props.presence.uniqueUsers,
}))
</script>

<template>
  <NPopover trigger="hover" placement="top" :show-arrow="false" style="padding: 10px 12px; max-width: 280px;">
    <template #trigger>
      <NTag
        size="tiny"
        type="success"
        class="host-presence-pill"
        :class="{ 'host-presence-pill--compact': compact }"
        data-host-presence-pill="true"
        :data-active-sessions="presence.activeSessions"
        :data-unique-users="presence.uniqueUsers"
      >
        <span class="host-presence-stack" aria-hidden="true">
          <UserAvatar
            v-for="user in visibleUsers"
            :key="user.id"
            :user="user"
            :size="18"
            class="host-presence-avatar"
          />
          <span v-if="hiddenUserCount > 0" class="host-presence-more">+{{ hiddenUserCount }}</span>
        </span>
        <span class="host-presence-label">{{ compact ? compactLabel : summaryLabel }}</span>
      </NTag>
    </template>

    <div class="host-presence-popover">
      <NText strong class="host-presence-title">{{ t('hosts.presence.title') }}</NText>
      <div class="host-presence-users">
        <div v-for="user in users" :key="user.id" class="host-presence-user">
          <UserAvatar :user="user" :size="28" />
          <div class="host-presence-user-text">
            <div class="host-presence-user-name">{{ user.name }}</div>
            <div class="host-presence-user-meta">
              {{ user.email }} &middot; {{ t('hosts.presence.sessionCount', { count: user.sessions.length }) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.host-presence-pill {
  --n-height: 22px;
  max-width: 100%;
}

.host-presence-pill :deep(.n-tag__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}

.host-presence-pill--compact {
  --n-height: 24px;
}

.host-presence-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-presence-stack {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding-left: 2px;
}

.host-presence-avatar {
  margin-left: -4px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(22, 163, 74, 0.25);
}

.host-presence-avatar:first-child {
  margin-left: 0;
}

.host-presence-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin-left: -4px;
  padding: 0 4px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  background: #14532d;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.host-presence-popover {
  display: grid;
  gap: 8px;
}

.host-presence-title {
  display: block;
  font-size: 12px;
}

.host-presence-users {
  display: grid;
  gap: 8px;
}

.host-presence-user {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.host-presence-user-text {
  min-width: 0;
}

.host-presence-user-name {
  overflow: hidden;
  color: var(--n-text-color);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-presence-user-meta {
  overflow: hidden;
  color: var(--n-text-color-3);
  font-size: 11px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
