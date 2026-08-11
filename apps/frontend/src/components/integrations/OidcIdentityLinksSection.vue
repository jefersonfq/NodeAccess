<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NInput, NPagination, NSpin, NTag, NText, useDialog, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import {
  externalIdentityAdminService,
  type ExternalIdentityAdminItem,
} from '@/services/external-identity-admin.service'

const PAGE_SIZE = 8
const { locale, t } = useI18n()
const dialog = useDialog()
const message = useMessage()
const loading = ref(true)
const loadError = ref(false)
const revokingId = ref<number | null>(null)
const identities = ref<ExternalIdentityAdminItem[]>([])
const search = ref('')
const page = ref(1)

const activeCount = computed(() => identities.value.filter((identity) => identity.active).length)
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return identities.value
  return identities.value.filter((identity) => [
    identity.user.name,
    identity.user.email,
    identity.emailAtLink,
    identity.issuer,
    identity.providerKey,
  ].some((value) => value?.toLowerCase().includes(query)))
})
const pageItems = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))

watch(search, () => { page.value = 1 })
watch(pageCount, (count) => { if (page.value > count) page.value = count })

function formatDate(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const { data } = await externalIdentityAdminService.list()
    identities.value = data
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function confirmRevoke(identity: ExternalIdentityAdminItem): void {
  dialog.warning({
    title: t('admin.integrations.oidc.identities.revokeTitle'),
    content: t('admin.integrations.oidc.identities.revokeDescription', { email: identity.user.email }),
    positiveText: t('admin.integrations.oidc.identities.revokeAction'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      revokingId.value = identity.id
      try {
        await externalIdentityAdminService.revoke(identity.id)
        await load()
        message.success(t('admin.integrations.oidc.identities.revoked'))
      } catch (error: unknown) {
        const apiError = error as { response?: { data?: { message?: string } } }
        message.error(apiError.response?.data?.message ?? t('admin.integrations.oidc.identities.revokeError'))
        return false
      } finally {
        revokingId.value = null
      }
    },
  })
}

onMounted(load)
</script>

<template>
  <CollapsibleSection
    :title="$t('admin.integrations.oidc.identities.title')"
    body-class="mt-2 !bg-transparent"
  >
    <template #header-extra>
      <NTag size="small" :bordered="false">
        {{ $t('admin.integrations.oidc.identities.activeCount', { count: activeCount }) }}
      </NTag>
    </template>

    <NSpin :show="loading">
      <div class="space-y-3">
        <NText depth="3" class="block text-xs">
          {{ $t('admin.integrations.oidc.identities.help') }}
        </NText>

        <NAlert
          v-if="loadError"
          type="error"
          :title="$t('admin.integrations.oidc.identities.loadError')"
        >
          <NButton size="small" class="mt-2" @click="load">
            {{ $t('admin.integrations.oidc.identities.retry') }}
          </NButton>
        </NAlert>

        <template v-else-if="identities.length">
          <NInput
            v-model:value="search"
            clearable
            :placeholder="$t('admin.integrations.oidc.identities.search')"
            :aria-label="$t('admin.integrations.oidc.identities.search')"
          />

          <NEmpty
            v-if="!filtered.length"
            size="small"
            :description="$t('admin.integrations.oidc.identities.noResults')"
          />

          <div v-else class="space-y-2">
            <div
              v-for="identity in pageItems"
              :key="identity.id"
              class="flex flex-col gap-3 rounded-lg border border-gray-700/70 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate text-sm font-medium text-white">{{ identity.user.name }}</span>
                  <NTag size="small" :type="identity.active ? 'success' : 'default'">
                    {{ identity.active ? $t('admin.integrations.oidc.identities.active') : $t('admin.integrations.oidc.identities.revokedStatus') }}
                  </NTag>
                </div>
                <div class="truncate text-xs text-gray-400">{{ identity.user.email }}</div>
                <div class="truncate text-xs text-gray-500" :title="identity.issuer">
                  {{ identity.providerKey.toUpperCase() }} · {{ identity.issuer }}
                </div>
                <div v-if="identity.revokedAt" class="text-xs text-gray-500">
                  {{ $t('admin.integrations.oidc.identities.revokedAt', { at: formatDate(identity.revokedAt) }) }}
                </div>
              </div>
              <NButton
                v-if="identity.active"
                secondary
                type="error"
                size="small"
                :loading="revokingId === identity.id"
                :aria-label="$t('admin.integrations.oidc.identities.revokeFor', { email: identity.user.email })"
                @click="confirmRevoke(identity)"
              >
                {{ $t('admin.integrations.oidc.identities.revoke') }}
              </NButton>
            </div>
          </div>

          <NPagination
            v-if="pageCount > 1"
            v-model:page="page"
            :page-count="pageCount"
            size="small"
          />
        </template>

        <NEmpty
          v-else-if="!loading"
          size="small"
          :description="$t('admin.integrations.oidc.identities.empty')"
        />
      </div>
    </NSpin>
  </CollapsibleSection>
</template>
