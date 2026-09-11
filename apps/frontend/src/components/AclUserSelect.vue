<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { inventoryAclService } from '@/services/inventory-acl.service'

const props = defineProps<{ nodeId: number; value: number | null; selectedLabel?: string }>()
const emit = defineEmits<{ 'update:value': [value: number | null]; selected: [option: { value: number; label: string }] }>()
const { t } = useI18n()
const options = ref<Array<{ value: number; label: string }>>([])
const loading = ref(false)
const failed = ref(false)
const query = ref('')
const page = ref(0)
const total = ref(0)
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
const displayed = computed(() => props.value !== null && props.selectedLabel && !options.value.some(option => option.value === props.value)
  ? [{ value: props.value, label: props.selectedLabel }, ...options.value] : options.value)

async function load(append = false): Promise<void> {
  const current = ++generation
  const nextPage = append ? page.value + 1 : 1
  loading.value = true
  failed.value = false
  try {
    const { data } = await inventoryAclService.searchUsers(props.nodeId, query.value, nextPage)
    if (current !== generation) return
    const results = data.data.map(user => ({ value: user.id, label: user.email ? `${user.name} · ${user.email}` : user.name }))
    options.value = append ? [...options.value, ...results.filter(option => !options.value.some(existing => existing.value === option.value))] : results
    page.value = nextPage
    total.value = data.total
  } catch {
    if (current === generation) failed.value = true
  } finally { if (current === generation) loading.value = false }
}
function search(value: string): void {
  clearTimeout(timer)
  generation++
  query.value = value
  options.value = []
  total.value = 0
  page.value = 0
  timer = setTimeout(() => { void load() }, 250)
}
function select(value: number | null): void {
  const option = displayed.value.find(item => item.value === value)
  if (option) emit('selected', option)
  emit('update:value', value)
}
watch(() => props.nodeId, () => { clearTimeout(timer); query.value = ''; options.value = []; total.value = 0; page.value = 0; void load() }, { immediate: true })
onUnmounted(() => { generation++; clearTimeout(timer) })
</script>

<template>
  <div class="w-full">
    <NSelect
      :value="value"
      :options="displayed"
      :loading="loading"
      :filterable="true"
      :remote="true"
      clearable
      :placeholder="t('hosts.inventoryAcl.ux.searchUsers')"
      @search="search"
      @update:value="select"
    />
    <NAlert
      v-if="failed"
      type="error"
      :show-icon="false"
      class="mt-2"
    >
      {{ t('hosts.inventoryAcl.ux.userSearchError') }}
      <NButton
        text
        @click="load(page > 0)"
      >
        {{ t('hosts.inventoryAcl.retry') }}
      </NButton>
    </NAlert>
    <NButton
      v-else-if="options.length < total"
      text
      size="small"
      :disabled="loading"
      @click="load(true)"
    >
      {{ t('hosts.inventoryAcl.ux.moreUsers', { shown: options.length, total }) }}
    </NButton>
  </div>
</template>
