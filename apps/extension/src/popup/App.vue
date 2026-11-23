<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { VaultItemKind, VaultItemSummary } from '@nodeaccess/shared'
import { ExtensionError, type ExtensionClient, type ExtensionFailure } from '../core/client'
import { message } from './messages'
import type { UpdateCheck } from '../core/update'
import PopupIcon from './PopupIcon.vue'

/** `update` (NA-0190, local builds): whether the portal announces a newer build on disk, and how to reload it. */
const props = defineProps<{ client: ExtensionClient; requestConnection: () => Promise<{ ok: boolean; reason?: ExtensionFailure }>; open: (url: string) => Promise<unknown>
  update?: { check: UpdateCheck; apply: () => void } }>()
// Same language as the NodeAccess portal (pt-BR), whatever the browser UI language is.
const t = message('pt-BR')
const phase = ref<'loading' | 'disconnected' | 'connecting' | 'connected'>('loading')
const query = ref(''), kind = ref<VaultItemKind | ''>(''), items = ref<VaultItemSummary[]>([]), next = ref<string | null>(null)
const fingerprint = ref(''), updateAvailable = ref(false)
const recents = ref<string[]>([]), error = ref<ExtensionFailure | ''>(''), searching = ref(false)
const kinds: Array<{ value: VaultItemKind | ''; label: string }> = [{ value: '', label: t.all }, { value: 'secret', label: t.secret }, { value: 'pem', label: t.pem }]
const busy = computed(() => searching.value && !items.value.length)
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
function setKind(value: VaultItemKind | ''): void {
  if (kind.value === value) return
  kind.value = value
  void search()
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
onMounted(() => { void props.update?.check.available().then(value => { updateAvailable.value = value }) })
function applyUpdate(): void { props.update?.apply() }
onMounted(async () => {
  if (!await props.client.connected()) { phase.value = 'disconnected'; return }
  phase.value = 'connected'
  recents.value = await props.client.recents()
  await search()
})
defineExpose({ search, connect, disconnect, openItem, setKind, applyUpdate })
</script>

<template>
  <main
    class="popup"
    data-testid="vaultnaccess-popup"
    :aria-busy="phase === 'loading' || searching"
  >
    <header class="bar">
      <span class="brand">
        <span
          class="mark"
          aria-hidden="true"
        ><PopupIcon name="shield" /></span>
        <span class="titles">
          <strong>VaultNAccess</strong>
          <small>{{ t.subtitle }}</small>
        </span>
      </span>
      <span
        v-if="phase === 'connected'"
        class="status"
      >
        <span
          class="dot"
          aria-hidden="true"
        />{{ t.connected }}
      </span>
    </header>

    <div
      v-if="updateAvailable"
      class="update"
      role="status"
      data-testid="vaultnaccess-update"
    >
      <span>{{ t.updateAvailable }}</span>
      <button
        type="button"
        class="update-button"
        data-testid="vaultnaccess-update-apply"
        @click="applyUpdate"
      >
        {{ t.update }}
      </button>
    </div>

    <p
      v-if="error"
      class="alert"
      role="alert"
      data-testid="vaultnaccess-error"
    >
      <PopupIcon name="alert" />
      <span>{{ t.errors[error] }}</span>
    </p>

    <section
      v-if="phase === 'loading'"
      class="skeleton"
      aria-hidden="true"
    >
      <span /><span /><span />
    </section>

    <section
      v-else-if="phase === 'disconnected' || phase === 'connecting'"
      class="welcome"
    >
      <span
        class="hero"
        aria-hidden="true"
      ><PopupIcon name="lock" /></span>
      <p class="intro">
        {{ t.intro }}
      </p>
      <button
        type="button"
        class="primary"
        :disabled="phase === 'connecting'"
        data-testid="vaultnaccess-connect"
        @click="connect"
      >
        <span
          v-if="phase === 'connecting'"
          class="spinner"
          aria-hidden="true"
        />
        {{ phase === 'connecting' ? t.connecting : t.connect }}
      </button>
      <div
        v-if="phase === 'connecting' && fingerprint"
        class="fingerprint"
        data-testid="vaultnaccess-fingerprint"
      >
        <span>{{ t.compare }}</span>
        <code>{{ fingerprint }}</code>
      </div>
    </section>

    <section
      v-else-if="phase === 'connected'"
      class="connected"
    >
      <form
        class="search"
        role="search"
        @submit.prevent="search()"
      >
        <PopupIcon name="search" />
        <input
          v-model="query"
          type="search"
          :aria-label="t.search"
          :placeholder="t.search"
          maxlength="100"
          autocomplete="off"
          data-testid="vaultnaccess-search"
        >
      </form>
      <div
        class="segments"
        role="group"
        :aria-label="t.kind"
      >
        <button
          v-for="option in kinds"
          :key="option.value || 'all'"
          type="button"
          :class="{ active: kind === option.value }"
          :aria-pressed="kind === option.value"
          @click="setKind(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <div
        v-if="recentItems.length && !query"
        class="group"
      >
        <h2>{{ t.recents }}</h2>
        <ul class="chips">
          <li
            v-for="item in recentItems"
            :key="`r-${item.kind}:${item.sourceId}`"
          >
            <button
              type="button"
              class="chip"
              :title="t.open"
              @click="openItem(item)"
            >
              <PopupIcon :name="item.kind === 'secret' ? 'key' : 'file'" />
              <span>{{ item.label }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div class="group">
        <h2 v-if="items.length">
          {{ t.items }}
        </h2>
        <div
          v-if="busy"
          class="skeleton"
          aria-hidden="true"
        >
          <span /><span /><span />
        </div>
        <p
          v-else-if="!searching && !items.length"
          class="empty"
        >
          <PopupIcon name="search" />
          {{ t.empty }}
        </p>
        <ul
          class="results"
          data-testid="vaultnaccess-results"
        >
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
              <span
                class="kind"
                :class="item.kind"
                aria-hidden="true"
              ><PopupIcon :name="item.kind === 'secret' ? 'key' : 'file'" /></span>
              <span class="body">
                <span class="label">{{ item.label }}</span>
                <span
                  v-if="item.description"
                  class="description"
                >{{ item.description }}</span>
                <span class="meta">
                  <span class="tag">{{ item.kind === 'secret' ? t.secret : t.pem }}</span>
                  <span class="tag">{{ item.scope === 'personal' ? t.personal : t.shared }}</span>
                </span>
              </span>
              <span
                class="go"
                aria-hidden="true"
              ><PopupIcon name="external" /></span>
            </button>
          </li>
        </ul>
        <button
          v-if="next"
          type="button"
          class="more"
          :disabled="searching"
          @click="search(true)"
        >
          {{ t.more }}
        </button>
      </div>
    </section>

    <footer class="foot">
      <span class="note">
        <PopupIcon name="lock" />{{ t.footer }}
      </span>
      <button
        v-if="phase === 'connected'"
        type="button"
        class="link"
        @click="disconnect"
      >
        {{ t.disconnect }}
      </button>
    </footer>
  </main>
</template>

<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff; --surface: #f6f7f9; --surface-2: #eef0f3; --border: #e0e0e6; --text: #1f2225; --muted: #5c6168;
  --primary: #18a058; --primary-hover: #36ad6a; --primary-text: #ffffff; --primary-soft: rgba(24, 160, 88, .12);
  --secret: #2080f0; --secret-soft: rgba(32, 128, 240, .12); --pem: #b36b00; --pem-soft: rgba(240, 160, 32, .16);
  --danger: #c0392b; --danger-soft: rgba(208, 48, 80, .1); --focus: rgba(24, 160, 88, .45);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101014; --surface: #18181c; --surface-2: #26262a; --border: rgba(255, 255, 255, .09); --text: rgba(255, 255, 255, .86); --muted: rgba(255, 255, 255, .56);
    --primary: #63e2b7; --primary-hover: #7fe7c4; --primary-text: #0f2a20; --primary-soft: rgba(99, 226, 183, .14);
    --secret: #70c0e8; --secret-soft: rgba(112, 192, 232, .14); --pem: #f2c97d; --pem-soft: rgba(242, 201, 125, .14);
    --danger: #e88080; --danger-soft: rgba(232, 128, 128, .14); --focus: rgba(99, 226, 183, .5);
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
button, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .6; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.icon { width: 16px; height: 16px; flex: none; }

.popup { width: 360px; min-height: 220px; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: var(--primary-soft); color: var(--primary); }
.mark .icon { width: 18px; height: 18px; }
.titles { display: flex; flex-direction: column; line-height: 1.2; }
.titles strong { font-size: 14px; letter-spacing: .01em; }
.titles small { color: var(--muted); font-size: 11px; }
.status { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; background: var(--primary-soft); color: var(--primary); font-size: 11px; font-weight: 600; white-space: nowrap; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.update { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 14px 0; padding: 8px 10px; border-radius: 6px; background: var(--primary-soft); color: var(--text); font-size: 12px; }
.update-button { flex: none; padding: 4px 10px; border: 0; border-radius: 4px; background: var(--primary); color: var(--primary-text); font-weight: 600; font-size: 12px; }
.update-button:hover { background: var(--primary-hover); }
.alert { display: flex; gap: 8px; align-items: flex-start; margin: 10px 14px 0; padding: 8px 10px; border-radius: 6px; background: var(--danger-soft); color: var(--danger); }
.alert .icon { margin-top: 1px; }

.welcome { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; padding: 22px 20px 18px; }
.hero { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); }
.hero .icon { width: 22px; height: 22px; }
.intro { margin: 0; color: var(--muted); }
.primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 9px 14px; border: 0; border-radius: 6px; background: var(--primary); color: var(--primary-text); font-weight: 600; }
.primary:hover:not(:disabled) { background: var(--primary-hover); }
.spinner { width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
.fingerprint { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 10px; border: 1px dashed var(--border); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
.fingerprint code { color: var(--text); font: 600 15px/1.3 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .08em; overflow-wrap: anywhere; }

.connected { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px 4px; }
.search { display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--muted); }
.search:focus-within { border-color: var(--primary); box-shadow: 0 0 0 2px var(--focus); }
.search input { flex: 1; min-width: 0; padding: 8px 0; border: 0; background: none; outline: none; }
.search input::placeholder { color: var(--muted); }
.segments { display: flex; padding: 2px; border-radius: 6px; background: var(--surface-2); }
.segments button { flex: 1; padding: 5px 6px; border: 0; border-radius: 4px; background: none; color: var(--muted); font-size: 12px; }
.segments button.active { background: var(--bg); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }

.group h2 { margin: 2px 0 6px; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
ul { list-style: none; margin: 0; padding: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); font-size: 12px; }
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip:hover { border-color: var(--primary); }
.chip .icon { width: 14px; height: 14px; color: var(--muted); }

.results { display: flex; flex-direction: column; gap: 2px; }
.item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 6px; background: none; text-align: left; }
.item:hover, .item:focus-visible { background: var(--surface); }
.kind { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 6px; }
.kind.secret { background: var(--secret-soft); color: var(--secret); }
.kind.pem { background: var(--pem-soft); color: var(--pem); }
.body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.label { font-weight: 600; overflow-wrap: anywhere; }
.description { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; gap: 4px; }
.tag { padding: 0 6px; border-radius: 4px; background: var(--surface-2); color: var(--muted); font-size: 11px; }
.go { color: var(--muted); opacity: 0; transition: opacity .12s; }
.item:hover .go, .item:focus-visible .go { opacity: 1; }
.more { width: 100%; margin-top: 6px; padding: 6px; border: 1px solid var(--border); border-radius: 6px; background: none; color: var(--primary); }
.empty { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 0; padding: 18px 0; color: var(--muted); }
.empty .icon { width: 22px; height: 22px; opacity: .6; }

.skeleton { display: flex; flex-direction: column; gap: 8px; padding: 14px; }
.connected .skeleton { padding: 0; }
.skeleton span { height: 36px; border-radius: 6px; background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.2s ease-in-out infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton span { animation: none; } }

.foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding: 10px 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; }
.note { display: inline-flex; align-items: center; gap: 6px; }
.note .icon { width: 12px; height: 12px; }
.link { padding: 2px 0; border: 0; background: none; color: var(--primary); font-size: 12px; font-weight: 600; }
.link:hover { text-decoration: underline; }
</style>
