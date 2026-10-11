import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth'
import api from '@/services/api'

export const useManualStore = defineStore('manual', () => {
  const auth = useAuthStore()
  const enabled = ref(false)
  const loading = ref(false)
  const failed = ref(false)
  let generation = 0
  const context = computed(() => `${auth.user?.id ?? ''}:${auth.user?.tenantId ?? ''}`)
  async function load(): Promise<void> {
    const current = ++generation
    enabled.value = false
    failed.value = false
    if (!auth.user) { loading.value = false; return }
    loading.value = true
    try {
      const { data } = await api.get<{ enabled: boolean }>('/settings/manual')
      if(current === generation) enabled.value = data.enabled === true
    } catch {
      if(current === generation) failed.value = true
    } finally {
      if(current === generation) loading.value = false
    }
  }
  async function save(value: boolean): Promise<boolean> {
    const currentContext = context.value
    try {
      const {data} = await api.patch<{ enabled:boolean }>('/settings/manual', {enabled:value})
      if (context.value !== currentContext) return false
      ++generation
      enabled.value = data.enabled === true
      failed.value = false
      loading.value = false
      return true
    } catch (error) {
      if (context.value !== currentContext) return false
      // A lost response can follow a committed write. Reconcile instead of claiming rollback.
      await load()
      throw error
    }
  }

  watch(context, () => { void load() }, {immediate:true, flush:'sync'})
  return {enabled,loading,failed,load,save}
})
