import { ref, computed, watch, type ComputedRef } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { Snippet } from '@/services/snippet.service'
type Library = { favorites: number[]; recent: Record<string, number> }
const libraries = ref<Record<string, Library>>({})
export function useSnippetLibrary(): { data: ComputedRef<Library>; toggle: (id: number) => void; record: (id: number) => void; select: (items: Snippet[], mode: string) => Snippet[] } {
  const auth = useAuthStore()
  const key = computed(() => 'nodeaccess:snippet-library:' + (auth.user?.tenantId ?? 0) + ':' + (auth.user?.id ?? 0))
  watch(key, value => {
    if (libraries.value[value]) return
    let data: Library = { favorites: [], recent: {} }
    try {
      const stored = JSON.parse(localStorage.getItem(value) ?? '{}') as Partial<Library>
      data = {
        favorites: Array.isArray(stored.favorites) ? stored.favorites.filter(id=>Number.isSafeInteger(id) && id > 0).slice(0,200) : [],
        recent: Object.fromEntries(Object.entries(stored.recent ?? {}).filter(([id,time])=>/^\d+$/.test(id) && typeof time === 'number' && Number.isFinite(time)).slice(-200)),
      }
    } catch { /* Browsers may disable storage; keep in-memory preferences. */ }
    libraries.value[value] = data
  }, { immediate: true })
  const data = computed<Library>(() => libraries.value[key.value] ?? {favorites:[],recent:{}})
  function save(next: Library): void {
    libraries.value[key.value] = next
    try { localStorage.setItem(key.value,JSON.stringify(next)) } catch { /* Memory fallback. */ }
  }
  function toggle(id: number): void {
    save({...data.value,favorites:data.value.favorites.includes(id) ? data.value.favorites.filter(value=>value!==id) : [...data.value.favorites,id].slice(-200)})
  }
  function record(id: number): void {
    const recent: Record<string, number> = { ...data.value.recent, [id]: Date.now() }
    save({...data.value,recent:Object.fromEntries(Object.entries(recent).sort((a,b)=>b[1]-a[1]).slice(0,200))})
  }
  function select(items: Snippet[], mode: string): Snippet[] {
    if (mode === 'favorites') return items.filter(item=>data.value.favorites.includes(item.id))
    if (mode === 'recent') return items.filter(item=>data.value.recent[item.id]).sort((a,b)=>(data.value.recent[b.id]??0)-(data.value.recent[a.id]??0))
    return items
  }
  return { data, toggle, record, select }
}
