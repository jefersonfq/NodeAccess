<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { VaultItemKind, VaultItemSummary } from '@nodeaccess/shared'
import { ExtensionError, type ExtensionClient, type ExtensionFailure } from '../core/client'
import { message } from './messages'

const props = defineProps<{ client: ExtensionClient; requestConnection: () => Promise<{ ok: boolean; reason?: ExtensionFailure }>; open: (url: string) => Promise<unknown> }>()
// Same language as the NodeAccess portal (pt-BR), whatever the browser UI language is.
const t = message('pt-BR')
const phase = ref<'loading' | 'disconnected' | 'connecting' | 'connected'>('loading')
const query = ref(''), kind = ref<VaultItemKind | ''>(''), items = ref<VaultItemSummary[]>([]), next = ref<string | null>(null)
const fingerprint = ref('')
const recents = ref<string[]>([]), error = ref<ExtensionFailure | ''>(''), searching = ref(false)
const recentItems = computed(() => recents.value.map(key => items.value.find(i => `${i.kind}:${i.sourceId}` === key)).filter((i): i is VaultItemSummary => !!i))
let generation = 0

function fail(failure: unknown): void {
  const reason = failure instanceof ExtensionError ? failure.reason : 'unavailable'
  error.value = reason
  if (reason === 'expired' || reason === 'denied') { phase.value = 'disconnected'; items.value = [] }
}
async function search(more = false): Promise<void> {
  const current = ++generation
  searching.value = true; error.value = ''
  try {
    const reply = await props.client.search(query.value, kind.value || undefined, more ? next.value ?? undefined : undefined)
    if (current !== generation) return
    items.value = more ? [...items.value, ...reply.items] : reply.items
    next.value = reply.nextCursor
  } catch (failure) { if (current === generation) fail(failure) } finally { if (current === generation) searching.value = false }
}
async function connect(): Promise<void> {
  phase.value = 'connecting'; error.value = ''
  fingerprint.value = await props.client.fingerprint().catch(() => '')
  const reply = await props.requestConnection().catch(() => ({ ok: false, reason: 'unavailable' as const }))
  if (!reply.ok) { phase.value = 'disconnected'; error.value = reply.reason ?? 'unavailable'; return }
  phase.value = 'connected'
  await search()
}
async function disconnect(): Promise<void> {
  ++generation
  await props.client.disconnect()
  items.value = []; recents.value = []; query.value = ''; phase.value = 'disconnected'
}
async function openItem(item: VaultItemSummary): Promise<void> {
  try {
    const url = props.client.portalUrl(item.portalPath)
    await props.client.remember(`${item.kind}:${item.sourceId}`)
    recents.value = await props.client.recents()
    await props.open(url)
  } catch (failure) { fail(failure) }
}
onMounted(async () => {
  if (!await props.client.connected()) { phase.value = 'disconnected'; return }
  phase.value = 'connected'
  recents.value = await props.client.recents()
  await search()
})
defineExpose({ search, connect, disconnect, openItem })
</script>

<template>
  <main
    class="popup"
    data-testid="vaultnaccess-popup"
  >
    <header class="bar">
      <strong>VaultNAccess</strong>
      <button
        v-if="phase === 'connected'"
        type="button"
        class="link"
        @click="disconnect"
      >
        {{ t.disconnect }}
      </button>
    </header>
    <p
      v-if="error"
      class="error"
      role="alert"
      data-testid="vaultnaccess-error"
    >
      {{ t.errors[error] }}
    </p>
    <section v-if="phase === 'disconnected' || phase === 'connecting'">
      <p>{{ t.intro }}</p>
      <button
        type="button"
        class="primary"
        :disabled="phase === 'connecting'"
        data-testid="vaultnaccess-connect"
        @click="connect"
      >
        {{ phase === 'connecting' ? t.connecting : t.connect }}
      </button>
      <p
        v-if="phase === 'connecting' && fingerprint"
        data-testid="vaultnaccess-fingerprint"
      >
        {{ t.compare }} <code>{{ fingerprint }}</code>
      </p>
    </section>
    <section v-else-if="phase === 'connected'">
      <form
        class="filters"
        role="search"
        @submit.prevent="search()"
      >
        <input
          v-model="query"
          type="search"
          :aria-label="t.search"
          :placeholder="t.search"
          maxlength="100"
          autocomplete="off"
          data-testid="vaultnaccess-search"
        >
        <select
          v-model="kind"
          :aria-label="t.kind"
          @change="search()"
        >
          <option value="">
            {{ t.all }}
          </option>
          <option value="secret">
            {{ t.secret }}
          </option>
          <option value="pem">
            {{ t.pem }}
          </option>
        </select>
      </form>
      <div v-if="recentItems.length && !query">
        <h2>{{ t.recents }}</h2>
        <ul>
          <li
            v-for="item in recentItems"
            :key="`r-${item.kind}:${item.sourceId}`"
          >
            <button
              type="button"
              class="item"
              @click="openItem(item)"
            >
              {{ item.label }}
            </button>
          </li>
        </ul>
      </div>
      <p
        v-if="!searching && !items.length"
        class="muted"
      >
        {{ t.empty }}
      </p>
      <ul data-testid="vaultnaccess-results">
        <li
          v-for="item in items"
          :key="`${item.kind}:${item.sourceId}`"
        >
          <button
            type="button"
            class="item"
            :title="t.open"
            @click="openItem(item)"
          >
            <span class="label">{{ item.label }}</span>
            <span class="meta">{{ item.kind === 'secret' ? t.secret : t.pem }} · {{ item.scope === 'personal' ? t.personal : t.shared }}</span>
          </button>
        </li>
      </ul>
      <button
        v-if="next"
        type="button"
        class="link"
        :disabled="searching"
        @click="search(true)"
      >
        {{ t.more }}
      </button>
    </section>
  </main>
</template>

<style>
body { margin: 0; font: 13px/1.4 system-ui, sans-serif; color: #111827; background: #fff; }
.popup { width: 340px; padding: 12px; }
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.filters { display: flex; gap: 6px; margin-bottom: 8px; }
.filters input { flex: 1; padding: 6px; border: 1px solid #9ca3af; border-radius: 4px; }
.primary { padding: 6px 12px; border: 0; border-radius: 4px; background: #1d4ed8; color: #fff; cursor: pointer; }
.primary:disabled { opacity: .6; }
.link { border: 0; background: none; color: #1d4ed8; cursor: pointer; padding: 4px 0; }
ul { list-style: none; margin: 0; padding: 0; }
.item { display: flex; flex-direction: column; width: 100%; text-align: left; padding: 6px; border: 0; border-bottom: 1px solid #e5e7eb; background: none; cursor: pointer; }
.item:hover, .item:focus-visible { background: #eff6ff; }
.label { font-weight: 600; overflow-wrap: anywhere; }
.meta, .muted { color: #4b5563; font-size: 12px; }
.error { color: #991b1b; background: #fef2f2; padding: 6px; border-radius: 4px; }
h2 { font-size: 12px; margin: 8px 0 4px; color: #4b5563; }
</style>
