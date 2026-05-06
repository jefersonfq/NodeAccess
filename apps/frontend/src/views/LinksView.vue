<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCard, NEmpty, NInput, NSpin, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { resolveHostLinkTemplate, type HostAssociatedLink, type HostPublic } from '@nodeaccess/shared'
import { hostService } from '@/services/host.service'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()

type HostLinkCatalogItem = {
  key: string
  host: HostPublic
  link: HostAssociatedLink
  resolvedUrl: string
}

const loading = ref(false)
const search = ref('')
const hosts = ref<HostPublic[]>([])

async function load() {
  loading.value = true
  try {
    const { data } = await hostService.list({ page: 1, limit: 200 })
    hosts.value = data.data
  } finally {
    loading.value = false
  }
}

onMounted(load)

const links = computed<HostLinkCatalogItem[]>(() =>
  hosts.value.flatMap((host) =>
    (host.associatedLinks ?? [])
      .filter((link) => link.enabled)
      .map((link, index) => ({
        key: `${host.id}-${link.id ?? index}-${link.label}`,
        host,
        link,
        resolvedUrl: resolveHostLinkTemplate(link.urlTemplate, {
          id: host.id,
          name: host.name,
          ip: host.ip,
          port: host.port,
          sshUser: host.sshUser,
        }),
      })),
  ),
)

const filteredLinks = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return links.value
  return links.value.filter((item) =>
    item.link.label.toLowerCase().includes(q)
    || item.host.name.toLowerCase().includes(q)
    || item.host.ip.toLowerCase().includes(q)
    || item.resolvedUrl.toLowerCase().includes(q)
    || (item.link.sourceProvider ?? '').toLowerCase().includes(q),
  )
})

function sourceTypeLabel(link: HostAssociatedLink) {
  if (link.sourceType === 'integration') return t('linksPage.source.integration')
  if (link.sourceType === 'derived') return t('linksPage.source.derived')
  return t('linksPage.source.manual')
}

function sourceStatusLabel(link: HostAssociatedLink) {
  if (link.sourceStatus === 'synced') return t('linksPage.status.synced')
  if (link.sourceStatus === 'stale') return t('linksPage.status.stale')
  if (link.sourceStatus === 'error') return t('linksPage.status.error')
  return t('linksPage.status.manual')
}

function providerLabel(link: HostAssociatedLink) {
  if (link.sourceProvider === 'onepassword') return '1Password'
  return link.sourceProvider ?? null
}

function openLink(item: HostLinkCatalogItem) {
  const target = item.link.openMode === 'same_tab' ? '_self' : '_blank'
  window.open(item.resolvedUrl, target, target === '_blank' ? 'noopener,noreferrer' : undefined)
}

async function copyLink(item: HostLinkCatalogItem) {
  await navigator.clipboard.writeText(item.resolvedUrl)
  message.success(t('linksPage.copied'))
}

function goToHost(hostId: number) {
  void router.push({ name: 'hosts', query: { editHostId: String(hostId) } })
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between gap-4 mb-5">
      <div>
        <h1 class="text-2xl font-bold text-white">{{ $t('linksPage.title') }}</h1>
        <p class="text-gray-400 mt-1 text-sm">{{ $t('linksPage.subtitle') }}</p>
      </div>
      <div class="text-xs text-gray-500">
        {{ $t('linksPage.count', { count: filteredLinks.length }) }}
      </div>
    </div>

    <div class="mb-4">
      <NInput
        v-model:value="search"
        clearable
        :placeholder="$t('linksPage.search')"
      />
    </div>

    <NSpin :show="loading">
      <NEmpty
        v-if="filteredLinks.length === 0"
        :description="search ? $t('linksPage.noResults') : $t('linksPage.empty')"
      />

      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <NCard
          v-for="item in filteredLinks"
          :key="item.key"
          size="small"
          :bordered="false"
          style="background:#17171c;"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-white truncate">{{ item.link.label }}</div>
              <button class="mt-1 text-xs text-gray-400 truncate hover:text-white" @click="goToHost(item.host.id)">
                {{ item.host.name }} · {{ item.host.ip }}
              </button>
            </div>
            <div class="flex flex-wrap justify-end gap-1">
              <NTag size="small" :type="item.link.sourceType === 'manual' ? 'default' : 'info'">
                {{ sourceTypeLabel(item.link) }}
              </NTag>
              <NTag size="small" :type="item.link.sourceStatus === 'error' ? 'error' : item.link.sourceStatus === 'stale' ? 'warning' : 'success'">
                {{ sourceStatusLabel(item.link) }}
              </NTag>
            </div>
          </div>

          <div v-if="providerLabel(item.link)" class="mt-2 text-[11px] text-gray-500">
            {{ providerLabel(item.link) }}
          </div>

          <div class="mt-3 rounded border border-gray-800 bg-[#111113] p-2.5">
            <div class="text-[11px] text-gray-500">{{ $t('linksPage.resolvedUrl') }}</div>
            <div class="mt-1 break-all font-mono text-[11px] text-blue-300">{{ item.resolvedUrl }}</div>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <NButton size="small" type="primary" @click="openLink(item)">{{ $t('linksPage.open') }}</NButton>
            <NButton size="small" quaternary @click="copyLink(item)">{{ $t('linksPage.copy') }}</NButton>
            <NButton size="small" quaternary @click="goToHost(item.host.id)">{{ $t('linksPage.goToHost') }}</NButton>
          </div>
        </NCard>
      </div>
    </NSpin>
  </div>
</template>
