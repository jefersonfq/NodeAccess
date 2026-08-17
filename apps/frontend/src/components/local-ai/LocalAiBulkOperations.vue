<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NSelect, NSpin, NText } from 'naive-ui'
import type { BastionPublic, HostPublic, PemKeyPublic, TagPublic } from '@nodeaccess/shared'
import { hostService } from '@/services/host.service'
import { bastionService } from '@/services/bastion.service'
import { pemKeyService } from '@/services/pem-key.service'
import { tagService } from '@/services/tag.service'
import HostBulkActionModal from '@/components/HostBulkActionModal.vue'
import HostBulkActionHistoryDrawer from '@/components/HostBulkActionHistoryDrawer.vue'

const props = defineProps<{ enabled: boolean }>()

const loading = ref(false)
const error = ref('')
const hosts = ref<HostPublic[]>([])
const bastions = ref<BastionPublic[]>([])
const pemKeys = ref<PemKeyPublic[]>([])
const tags = ref<TagPublic[]>([])
const selectedHostIds = ref<number[]>([])
const showAction = ref(false)
const showHistory = ref(false)
const loaded = ref(false)

const hostOptions = computed(() => hosts.value.map((host) => ({
  label: `${host.name} (${host.ip})`,
  value: host.id,
})))
const canOpen = computed(() => props.enabled && selectedHostIds.value.length > 0 && !loading.value)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [hostsRes, bastionsRes, pemKeysRes, tagsRes] = await Promise.all([
      hostService.list({ page: 1, limit: 500 }),
      bastionService.list(),
      pemKeyService.list(),
      tagService.list(),
    ])
    hosts.value = hostsRes.data.data
    bastions.value = bastionsRes.data
    pemKeys.value = pemKeysRes.data
    tags.value = tagsRes.data
    loaded.value = true
  } catch {
    error.value = 'load'
  } finally {
    loading.value = false
  }
}

async function onApplied() {
  await load()
}

onMounted(load)
watch(() => props.enabled, (enabled) => {
  if (enabled && !loaded.value && !loading.value) void load()
})
</script>

<template>
  <div class="space-y-4" data-testid="local-ai-bulk-operations">
    <div>
      <div class="text-sm font-medium text-white">{{ $t('localAi.bulk.title') }}</div>
      <NText depth="3" class="text-xs">{{ $t('localAi.bulk.subtitle') }}</NText>
    </div>

    <NAlert type="warning" :show-icon="false">
      {{ $t('localAi.bulk.guardrail') }}
    </NAlert>

    <div v-if="loading" class="flex items-center gap-2 text-sm text-zinc-400" data-testid="local-ai-bulk-loading">
      <NSpin size="small" /> {{ $t('localAi.bulk.loading') }}
    </div>
    <NAlert v-else-if="error" type="error" data-testid="local-ai-bulk-error">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>{{ $t('localAi.bulk.loadError') }}</span>
        <NButton size="small" secondary @click="load">{{ $t('localAi.bulk.retry') }}</NButton>
      </div>
    </NAlert>
    <NAlert v-else-if="hosts.length === 0" type="info" data-testid="local-ai-bulk-empty">
      {{ $t('localAi.bulk.empty') }}
    </NAlert>
    <div v-else class="space-y-3">
      <label class="block text-sm text-zinc-300" for="local-ai-bulk-hosts">{{ $t('localAi.bulk.hostsLabel') }}</label>
      <NSelect
        id="local-ai-bulk-hosts"
        v-model:value="selectedHostIds"
        :options="hostOptions"
        multiple
        filterable
        clearable
        :max-tag-count="'responsive'"
        :placeholder="$t('localAi.bulk.hostsPlaceholder')"
        data-testid="local-ai-bulk-hosts"
      />
      <div class="flex flex-wrap justify-end gap-2">
        <NButton secondary data-testid="local-ai-bulk-history" @click="showHistory = true">
          {{ $t('localAi.bulk.history') }}
        </NButton>
        <NButton type="primary" :disabled="!canOpen" data-testid="local-ai-bulk-review" @click="showAction = true">
          {{ $t('localAi.bulk.review', { count: selectedHostIds.length }) }}
        </NButton>
      </div>
    </div>

    <HostBulkActionModal
      v-if="showAction"
      :show="showAction"
      :selection="{ mode: 'ids', hostIds: selectedHostIds }"
      :selected-count="selectedHostIds.length"
      :bastions="bastions"
      :pem-keys="pemKeys"
      :tags="tags"
      @close="showAction = false"
      @applied="onApplied"
    />
    <HostBulkActionHistoryDrawer
      v-if="showHistory"
      :show="showHistory"
      @close="showHistory = false"
      @rolled-back="load"
    />
  </div>
</template>
