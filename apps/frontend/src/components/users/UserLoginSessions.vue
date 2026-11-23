<script setup lang="ts">
/**
 * NA-0187 — login sessions of one user for the tenant admin: IP of the login and of the last use, browser,
 * method, start and last use. "Disconnect" ends one session at its next request; "Disconnect all" also
 * closes terminals and graphical sessions (session version).
 */
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NEmpty, NSpin, NTag, NTooltip, useDialog, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { loginSessionsService, type LoginSession } from '@/services/login-sessions.service'
import { describeUserAgent } from '@/utils/user-agent'

const props = defineProps<{ userId: number; userName: string; self: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const { t, d } = useI18n()
const dialog = useDialog(), message = useMessage()
const sessions = ref<LoginSession[]>([]), loading = ref(false), failed = ref(false), busy = ref('')

async function load(): Promise<void> {
  loading.value = true; failed.value = false
  try { sessions.value = await loginSessionsService.list(props.userId) } catch { failed.value = true; sessions.value = [] } finally { loading.value = false }
}
const when = (at: number): string => d(new Date(at), 'short')
async function revoke(session: LoginSession): Promise<void> {
  busy.value = session.ref
  try {
    await loginSessionsService.revoke(props.userId, session.ref)
    message.success(t('admin.users.loginSessions.revoked'))
    emit('changed')
  } catch { message.error(t('admin.users.loginSessions.error')) } finally { busy.value = ''; await load() }
}
function confirmRevoke(session: LoginSession): void {
  dialog.warning({
    title: t('admin.users.loginSessions.confirmTitle'),
    content: t('admin.users.loginSessions.confirmOne', { ip: session.lastIp ?? session.ip ?? '—' }),
    positiveText: t('admin.users.loginSessions.disconnect'), negativeText: t('admin.users.loginSessions.cancel'),
    onPositiveClick: () => { void revoke(session) },
  })
}
async function revokeAll(): Promise<void> {
  busy.value = 'all'
  try {
    await loginSessionsService.revokeAll(props.userId)
    message.success(t('admin.users.loginSessions.revokedAll'))
    emit('changed')
  } catch { message.error(t('admin.users.loginSessions.error')) } finally { busy.value = ''; await load() }
}
function confirmRevokeAll(): void {
  dialog.warning({
    title: t('admin.users.loginSessions.confirmTitle'),
    content: t('admin.users.loginSessions.confirmAll', { name: props.userName }),
    positiveText: t('admin.users.loginSessions.disconnectAll'), negativeText: t('admin.users.loginSessions.cancel'),
    onPositiveClick: () => { void revokeAll() },
  })
}
onMounted(() => { void load() })
defineExpose({ load, revoke, revokeAll, confirmRevoke, confirmRevokeAll })
</script>

<template>
  <div data-testid="user-login-sessions">
    <p class="mb-3 text-sm text-gray-400">
      {{ t('admin.users.loginSessions.hint') }}
    </p>
    <NAlert
      v-if="failed"
      type="error"
      class="mb-3"
    >
      {{ t('admin.users.loginSessions.loadError') }}
    </NAlert>
    <NSpin :show="loading">
      <NEmpty
        v-if="!loading && !failed && !sessions.length"
        :description="t('admin.users.loginSessions.empty')"
      />
      <div
        v-else
        class="overflow-x-auto"
      >
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left">
              <th class="py-1 pr-3">
                {{ t('admin.users.loginSessions.ip') }}
              </th>
              <th class="py-1 pr-3">
                {{ t('admin.users.loginSessions.browser') }}
              </th>
              <th class="py-1 pr-3">
                {{ t('admin.users.loginSessions.method') }}
              </th>
              <th class="py-1 pr-3">
                {{ t('admin.users.loginSessions.started') }}
              </th>
              <th class="py-1 pr-3">
                {{ t('admin.users.loginSessions.lastSeen') }}
              </th>
              <th class="py-1" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="session in sessions"
              :key="session.ref"
              :data-testid="`user-login-session-${session.ref}`"
            >
              <td class="py-1 pr-3">
                <div>{{ session.lastIp ?? session.ip ?? '—' }}</div>
                <div
                  v-if="session.ip && session.lastIp && session.ip !== session.lastIp"
                  class="text-xs text-gray-500"
                >
                  {{ t('admin.users.loginSessions.loginIp', { ip: session.ip }) }}
                </div>
              </td>
              <td class="py-1 pr-3">
                <NTooltip>
                  <template #trigger>
                    <span>{{ describeUserAgent(session.userAgent) }}</span>
                  </template>
                  {{ session.userAgent ?? '—' }}
                </NTooltip>
              </td>
              <td class="py-1 pr-3">
                {{ session.authMethod }}
              </td>
              <td class="py-1 pr-3">
                {{ when(session.createdAt) }}
              </td>
              <td class="py-1 pr-3">
                {{ when(session.lastSeenAt) }}
              </td>
              <td class="py-1 text-right">
                <NTag
                  v-if="session.current"
                  size="small"
                  type="info"
                >
                  {{ t('admin.users.loginSessions.current') }}
                </NTag>
                <NButton
                  v-else
                  size="tiny"
                  type="error"
                  secondary
                  :loading="busy === session.ref"
                  :disabled="busy !== ''"
                  :data-testid="`user-login-session-revoke-${session.ref}`"
                  @click="confirmRevoke(session)"
                >
                  {{ t('admin.users.loginSessions.disconnect') }}
                </NButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </NSpin>
    <div
      v-if="!self && sessions.length"
      class="mt-4 flex justify-end"
    >
      <NButton
        type="error"
        :loading="busy === 'all'"
        :disabled="busy !== ''"
        data-testid="user-login-sessions-revoke-all"
        @click="confirmRevokeAll"
      >
        {{ t('admin.users.loginSessions.disconnectAll') }}
      </NButton>
    </div>
  </div>
</template>
