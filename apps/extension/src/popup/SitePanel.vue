<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { VaultSiteCreateSchema, VaultSiteUpdateSchema, vaultSiteUrl } from '../../../../packages/shared/src/schemas/vault-sites.schema'
import type { SitesClient, SiteWriteAccess, SiteHostOption, VaultSiteMetadata } from '../core/sites-port'
import { sanitizePreferences, type SitePreferences, type SitePreferencesPort } from '../core/site-preferences'
import type { CapturedSiteDraft } from '../core/portal-fill-intent'
import { generatePassword, type PasswordOptions } from '../core/password'

const props = withDefaults(defineProps<{
  client: SitesClient; currentOrigin?: string; locale?: string; writeAccess?: SiteWriteAccess;
  hostOptions?: SiteHostOption[]; fillEnabled?: boolean; fillBusy?: boolean; passwordGenerator?: (options?: PasswordOptions) => string;
  preferences?: SitePreferencesPort | undefined; capturedDraft?: CapturedSiteDraft | null;
}>(), { currentOrigin: '', locale: 'pt-BR', fillEnabled: false, hostOptions: () => [], writeAccess: () => ({ groups: [], tenant: false }), passwordGenerator: generatePassword, preferences: undefined, capturedDraft: null })
const emit = defineEmits<{ fill: [item: VaultSiteMetadata]; connect: [hostId: number]; open: [url: string]; saved: []; 'search-hosts': [query: string]; consumed: [id: string]; 'proof-required': [draft: CapturedSiteDraft] }>()
const pt = computed(() => props.locale.toLowerCase().startsWith('pt'))
const t = computed(() => pt.value ? {
  draftExpired: 'O rascunho expirou e foi descartado.', generatorInvalid: 'Escolha um comprimento de 8 a 128 e ao menos um tipo de caractere.', generatorOptions: 'Opções da senha', length: 'Comprimento', uppercase: 'Maiúsculas', lowercase: 'Minúsculas', digits: 'Números', symbols: 'Símbolos', favorites: 'Favoritos', recent: 'Recentes', allLoaded: 'Todos os itens carregados', favorite: 'Favoritar', preferenceFailed: 'Não foi possível salvar as preferências.', proof: 'Confirme sua identidade e volte para revisar e salvar. Os campos foram preservados.', captured: 'Login capturado. Revise os dados antes de salvar.', pendingCapture: 'Há um login capturado. Usar descarta o formulário atual.', useCapture: 'Usar login capturado', discard: 'Descartar', target: 'Salvar como', newLogin: 'Novo login pessoal',
  title: 'Sites', current: 'Neste site', all: 'Todos os sites', search: 'Buscar sites', add: 'Novo item', edit: 'Editar',
  login: 'Login', url: 'Link', name: 'Nome', username: 'Usuário', password: 'Senha', origins: 'Sites deste login (um por linha)', sitesPreview: 'Este login será associado a:', sitesHint: 'Cole links HTTPS completos. Salvamos somente o endereço do site, sem o caminho da página.',
  address: 'URL HTTPS', generate: 'Gerar senha', save: 'Salvar', cancel: 'Cancelar', personal: 'Pessoal', group: 'Equipe', tenant: 'Organização',
  scope: 'Compartilhamento', hostSearch: 'Buscar host', host: 'Host vinculado', none: 'Nenhum', fill: 'Preencher', connect: 'Abrir terminal no NodeAccess', open: 'Abrir site',
  empty: 'Nenhum item encontrado.', loading: 'Carregando…', more: 'Carregar mais', retry: 'Tentar novamente',
  invalid: 'Revise os campos e as opções de acesso. Use sites HTTPS sem usuário ou senha no endereço.', failed: 'Não foi possível confirmar a gravação. Confira a lista antes de tentar novamente. A senha foi apagada.',
  loadFailed: 'Não foi possível carregar os sites.', preserve: 'Deixe em branco para manter a senha atual.',
  pilot: 'Preenchimento indisponível neste ambiente piloto.', allowFill: 'Permitir preenchimento neste login', saved: 'Item salvo.',
} : {
  draftExpired: 'The draft expired and was discarded.', generatorInvalid: 'Choose a length from 8 to 128 and at least one character type.', generatorOptions: 'Password options', length: 'Length', uppercase: 'Uppercase', lowercase: 'Lowercase', digits: 'Numbers', symbols: 'Symbols', favorites: 'Favorites', recent: 'Recent', allLoaded: 'All loaded items', favorite: 'Favorite', preferenceFailed: 'Could not save preferences.', proof: 'Confirm your identity, then return to review and save. Your fields were preserved.', captured: 'Captured login. Review the details before saving.', pendingCapture: 'A captured login is available. Using it discards the current form.', useCapture: 'Use captured login', discard: 'Discard', target: 'Save as', newLogin: 'New personal login',
  title: 'Sites', current: 'This site', all: 'All sites', search: 'Search sites', add: 'New item', edit: 'Edit',
  login: 'Login', url: 'Link', name: 'Name', username: 'Username', password: 'Password', origins: 'Websites for this login (one per line)', sitesPreview: 'This login will be associated with:', sitesHint: 'Paste complete HTTPS links. Only the website address is saved, without the page path.',
  address: 'HTTPS URL', generate: 'Generate password', save: 'Save', cancel: 'Cancel', personal: 'Personal', group: 'Team', tenant: 'Organization',
  scope: 'Sharing', hostSearch: 'Search hosts', host: 'Linked host', none: 'None', fill: 'Fill', connect: 'Open terminal in NodeAccess', open: 'Open site',
  empty: 'No items found.', loading: 'Loading…', more: 'Load more', retry: 'Retry',
  invalid: 'Check the fields and access options. Use HTTPS websites without a username or password in the address.', failed: 'Could not confirm the save. Check the list before trying again. The password was cleared.',
  loadFailed: 'Could not load sites.', preserve: 'Leave blank to keep the current password.',
  pilot: 'Filling is unavailable in this pilot environment.', allowFill: 'Allow filling this login', saved: 'Item saved.',
})
const generator = ref({ length: 24, uppercase: true, lowercase: true, digits: true, symbols: true })
const preferenceData = ref<SitePreferences>({ favorites: [], recents: [] }), preferenceFilter = ref<'all' | 'favorites' | 'recent'>('all')
const preferenceError = ref(''), preferenceBusy = ref(false)
let preferenceEpoch = 0, preferenceQueue: Promise<void> = Promise.resolve()
const restoredEditor = ref(false)
let draftDeadline = 0, stagedDraftId = ''
let draftTimer: ReturnType<typeof setTimeout> | undefined, pendingDraftTimer: ReturnType<typeof setTimeout> | undefined
const captureOrigin = ref(''), captureTarget = ref<number | null>(null), consumedId = ref('')
const capturedUsername = ref<string | null>(null), captureUsernameEdited = ref(false)
const pendingDraft = computed(() => props.capturedDraft?.id !== consumedId.value ? props.capturedDraft : null)
const origin = computed(() => { try { return vaultSiteUrl(props.currentOrigin, true) } catch { return '' } })
const tab = ref<'current' | 'all'>(origin.value ? 'current' : 'all'), search = ref('')
const items = ref<VaultSiteMetadata[]>([]), next = ref<number | null>(null), loading = ref(false), loadError = ref('')
const nameField = ref<HTMLInputElement | null>(null), newItemButton = ref<HTMLButtonElement | null>(null)
const retryPage = ref(false)
const editing = ref(false), selected = ref<VaultSiteMetadata | null>(null), busy = ref(false), error = ref(''), notice = ref('')
const kind = ref<'login' | 'url'>('login'), label = ref(''), username = ref(''), password = ref(''), origins = ref(''), url = ref('')
const normalizedOrigins = computed<string[] | null>(() => {
  try {
    const websites = origins.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    return [...new Set(websites.map(value => new URL(vaultSiteUrl(value)).origin))]
  } catch { return null }
})
const scope = ref<'PERSONAL' | 'GROUP' | 'TENANT'>('PERSONAL'), groupId = ref<number | undefined>(), hostId = ref<number | null>(null), allowFill = ref(false)
const hostChanged = ref(false), hostSearch = ref(''), chosenHost = ref<SiteHostOption | null>(null)
let hostSearchTimer: ReturnType<typeof setTimeout> | undefined
let alive = true, generation = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const captureCandidates = computed(() => items.value.filter(item => item.kind === 'login' && item.canManage && item.origins.includes(captureOrigin.value)))
const visible = computed(() => items.value.filter(item => {
  const matches = item.kind === 'login' ? item.origins.includes(origin.value) : ((): boolean => { try { return new URL(item.url!).origin === origin.value } catch { return false } })()
  const allowed = preferenceFilter.value === 'all' || (preferenceFilter.value === 'favorites' ? preferenceData.value.favorites.includes(item.id) : preferenceData.value.recents.some(recent => recent.id === item.id))
  return allowed && (tab.value === 'all' || (!!origin.value && matches))
}).sort((a, b) => {
  const favorites = preferenceData.value.favorites
  const favoriteOrder = preferenceFilter.value === 'recent' ? 0 : Number(favorites.includes(b.id)) - Number(favorites.includes(a.id))
  return favoriteOrder || (preferenceData.value.recents.find(row => row.id === b.id)?.at ?? 0) - (preferenceData.value.recents.find(row => row.id === a.id)?.at ?? 0)
}))
function safePreferences(value: SitePreferences): SitePreferences { return sanitizePreferences(value, Date.now()) }
watch((): SitePreferencesPort | undefined => props.preferences, port => {
  const epoch = ++preferenceEpoch
  preferenceData.value = { favorites: [], recents: [] }; preferenceFilter.value = 'all'; preferenceError.value = ''; preferenceBusy.value = false
  preferenceQueue = Promise.resolve()
  if (port) preferenceQueue = port.load().then(value => { if (alive && epoch === preferenceEpoch) preferenceData.value = safePreferences(value) }).catch(() => { if (alive && epoch === preferenceEpoch) preferenceError.value = t.value.preferenceFailed })
}, { immediate: true })
function preferenceAction(id: number, favorite?: boolean): void {
  const port = props.preferences, epoch = preferenceEpoch
  if (!port || !items.value.some(item => item.id === id)) return
  preferenceBusy.value = true; preferenceError.value = ''
  preferenceQueue = preferenceQueue.then(async () => {
    if (!alive || epoch !== preferenceEpoch || !items.value.some(item => item.id === id)) return
    const value = favorite === undefined ? await port.used(id) : await port.favorite(id, favorite)
    if (alive && epoch === preferenceEpoch) preferenceData.value = safePreferences(value)
  }).catch(() => { if (alive && epoch === preferenceEpoch) preferenceError.value = t.value.preferenceFailed }).finally(() => { if (alive && epoch === preferenceEpoch) preferenceBusy.value = false })
}
function toggleFavorite(item: VaultSiteMetadata): void { if (!preferenceBusy.value) preferenceAction(item.id, !preferenceData.value.favorites.includes(item.id)) }
function releaseDraft(): void {
  clearTimeout(draftTimer); draftDeadline = 0
  if (stagedDraftId) emit('consumed', stagedDraftId)
  stagedDraftId = ''
}
function expireDraft(): void {
  password.value = ''; username.value = ''; origins.value = ''; url.value = ''; label.value = ''
  captureOrigin.value = ''; selected.value = null; editing.value = false; releaseDraft(); notice.value = t.value.draftExpired
}
function draftExpiresAt(draft: CapturedSiteDraft): number {
  return 'expiresAt' in draft && typeof draft.expiresAt === 'number' && Number.isFinite(draft.expiresAt) ? Math.min(draft.expiresAt, Date.now() + 120_000) : Date.now() + 120_000
}
function armDraft(id: string, expiresAt = Date.now() + 120_000): void {
  clearTimeout(draftTimer); stagedDraftId = id
  draftDeadline = Math.min(draftDeadline || expiresAt, expiresAt)
  draftTimer = setTimeout(() => { if (alive) expireDraft() }, Math.max(0, draftDeadline - Date.now()))
}
function discardCapture(): void {
  clearTimeout(pendingDraftTimer)
  const draft = pendingDraft.value
  if (draft) { consumedId.value = draft.id; emit('consumed', draft.id) }
}
function useCapture(): void {
  const draft = pendingDraft.value
  if (!draft || busy.value) return
  const expiresAt = draftExpiresAt(draft)
  if (expiresAt <= Date.now()) { discardCapture(); notice.value = t.value.draftExpired; return }
  let normalized: string
  try { normalized = vaultSiteUrl(draft.origin, true) } catch { discardCapture(); error.value = t.value.invalid; return }
  if (typeof draft.id !== 'string' || !draft.id || draft.id.length > 128 || typeof draft.username !== 'string' || typeof draft.password !== 'string') { discardCapture(); error.value = t.value.invalid; return }
  const editor = draft.editor
  const payload = editor ? {
    label: editor.label, ...(editor.hostId !== undefined ? { hostId: editor.hostId } : {}),
    ...(editor.kind === 'login' ? { username: draft.username, origins: editor.origins, allowFill: editor.allowFill, ...(draft.password ? { password: draft.password } : {}) } : { url: editor.url }),
    ...(editor.mode === 'update' ? { id: editor.siteId, version: editor.version } : { kind: editor.kind, scope: editor.scope, ...(editor.scope === 'GROUP' ? { groupId: editor.groupId } : {}) }),
  } : { kind: 'login', scope: 'PERSONAL', label: new URL(normalized).hostname, username: draft.username, password: draft.password, origins: [normalized] }
  const valid = editor?.mode === 'update' ? VaultSiteUpdateSchema.safeParse(payload).success : VaultSiteCreateSchema.safeParse(payload).success
  if (!valid || (editor && !['create', 'update'].includes(editor.mode))) { discardCapture(); error.value = t.value.invalid; return }
  start()
  capturedUsername.value = draft.username
  captureOrigin.value = normalized; captureTarget.value = null; label.value = editor?.label ?? new URL(normalized).hostname
  if (editor) {
    restoredEditor.value = true; kind.value = editor.kind; scope.value = editor.scope; groupId.value = editor.groupId
    origins.value = editor.origins.join('\n'); url.value = editor.url ?? ''; allowFill.value = editor.allowFill
    const known = items.value.find(item => item.id === editor.siteId)
    // Worker-held editor references carry the original version. The write endpoint rechecks ACL/version;
    // never retrieve plaintext or silently switch an update to a create when the popup reopens.
    if (editor.mode === 'update') selected.value = {
      id: editor.siteId!, version: editor.version!, kind: editor.kind, label: editor.label, scope: editor.scope,
      groupId: editor.groupId ?? null, username: draft.username, origins: editor.origins, url: editor.url ?? null,
      host: known?.host ?? null, canManage: known?.canManage ?? true, allowFill: editor.allowFill,
    }
    hostId.value = editor.hostId !== undefined ? editor.hostId : selected.value?.host?.id ?? null
    hostChanged.value = editor.hostId !== undefined
    chosenHost.value = hostId.value === null ? null : props.hostOptions.find(host => host.id === hostId.value) ?? { id: hostId.value, name: `Host #${hostId.value}` }
  } else origins.value = normalized
  username.value = draft.username; password.value = draft.password
  discardCapture(); armDraft(draft.id, expiresAt)
}

function selectCaptureTarget(): void {
  if (busy.value || !captureOrigin.value) return
  const item = captureTarget.value === null ? null : captureCandidates.value.find(item => item.id === captureTarget.value)
  if (captureTarget.value !== null && !item) { captureTarget.value = null; return }
  selected.value = item ?? null; label.value = item?.label ?? new URL(captureOrigin.value).hostname
  if (capturedUsername.value === '' && !captureUsernameEdited.value) username.value = item?.username ?? ''
  scope.value = item?.scope ?? 'PERSONAL'; groupId.value = item?.groupId ?? undefined
  chosenHost.value = item?.host ?? null; hostChanged.value = false; hostId.value = item?.host?.id ?? null
  origins.value = item ? item.origins.join('\n') : captureOrigin.value; allowFill.value = item?.allowFill ?? false
}
async function load(more = false): Promise<void> {
  if (more && (loading.value || next.value === null)) return
  clearTimeout(searchTimer)
  const run = ++generation
  loading.value = true; loadError.value = ''; retryPage.value = false
  if (!more) { items.value = []; next.value = null }
  try {
    const reply = await props.client.list({ after: more ? next.value! : 0, limit: 50, ...(search.value.trim() ? { q: search.value.trim() } : {}), ...(tab.value === 'current' && origin.value ? { origin: origin.value } : {}) })
    if (!alive || run !== generation) return
    items.value = more ? [...items.value, ...reply.items.filter(item => !items.value.some(old => old.id === item.id))] : reply.items
    next.value = reply.next
  } catch { if (alive && run === generation) { loadError.value = t.value.loadFailed; retryPage.value = more } }
  finally { if (alive && run === generation) loading.value = false }
}
watch([(): SitesClient => props.client, origin, tab], (): void => { void load() }, { immediate: true })
watch(search, (): void => {
  clearTimeout(searchTimer); generation++; items.value = []; next.value = null; loading.value = true; loadError.value = ''
  searchTimer = setTimeout(() => { void load() }, 250)
}, { flush: 'sync' })
watch(hostSearch, (): void => {
  clearTimeout(hostSearchTimer)
  hostSearchTimer = setTimeout(() => { if (alive && editing.value) emit('search-hosts', hostSearch.value.trim()) }, 200)
}, { flush: 'sync' })
watch(hostId, value => {
  chosenHost.value = props.hostOptions.find(host => host.id === value) ?? (chosenHost.value?.id === value ? chosenHost.value : null)
}, { flush: 'sync' })
function start(item?: VaultSiteMetadata): void {
  if (busy.value || (item && !item.canManage)) return
  releaseDraft(); restoredEditor.value = false; captureOrigin.value = ''; captureTarget.value = null
  capturedUsername.value = null; captureUsernameEdited.value = false
  selected.value = item ?? null; kind.value = item?.kind ?? 'login'; label.value = item?.label ?? ''
  username.value = item?.username ?? ''; password.value = ''; origins.value = item ? item.origins.join('\n') : origin.value
  url.value = item?.url ?? origin.value; scope.value = item?.scope ?? 'PERSONAL'; groupId.value = item?.groupId ?? undefined
  hostSearch.value = ''; chosenHost.value = item?.host ?? null
  hostChanged.value = false; hostId.value = item?.host?.id ?? null; allowFill.value = item?.allowFill ?? false
  error.value = ''; notice.value = ''; editing.value = true
  void nextTick(() => { if (alive && editing.value) nameField.value?.focus() })
}
function cancel(): void { if (!busy.value) { releaseDraft(); clearTimeout(hostSearchTimer); password.value = ''; username.value = ''; origins.value = ''; label.value = ''; captureOrigin.value = ''; editing.value = false; selected.value = null; error.value = ''; void nextTick(() => { if (alive) newItemButton.value?.focus() }) } }
function generate(): void {
  if (busy.value) return
  try { password.value = props.passwordGenerator(generator.value); error.value = '' } catch { error.value = t.value.generatorInvalid }
}
function canFill(item: VaultSiteMetadata): boolean {
  return props.fillEnabled && item.kind === 'login' && item.allowFill && !!origin.value && item.origins.includes(origin.value)
}
function fill(item: VaultSiteMetadata): void { if (canFill(item) && !props.fillBusy) { preferenceAction(item.id); emit('fill', item) } }
function connect(item: VaultSiteMetadata): void { if (item.host) { preferenceAction(item.id); emit('connect', item.host.id) } }
function open(item: VaultSiteMetadata): void {
  const target = item.kind === 'url' ? item.url : item.origins[0]
  if (target) { try { const destination = vaultSiteUrl(target); preferenceAction(item.id); emit('open', destination) } catch { /* Invalid metadata is never navigated. */ } }
}
async function save(): Promise<void> {
  if (busy.value || !editing.value) return
  if (draftDeadline && Date.now() >= draftDeadline) { expireDraft(); return }
  error.value = ''
  const previous = selected.value
  if (captureOrigin.value && !restoredEditor.value && previous && !captureCandidates.value.some(item => item.id === previous.id && item.version === previous.version)) { error.value = t.value.invalid; return }
  const hostAllowed = hostId.value === null || props.hostOptions.some(host => host.id === hostId.value) || previous?.host?.id === hostId.value || chosenHost.value?.id === hostId.value
  const scopeAllowed = previous || scope.value === 'PERSONAL' || (scope.value === 'TENANT' ? props.writeAccess?.tenant : props.writeAccess?.groups.some(group => group.id === groupId.value))
  if (kind.value === 'login' && normalizedOrigins.value === null) { error.value = t.value.invalid; return }
  const details = kind.value === 'login'
    ? { username: username.value, origins: normalizedOrigins.value, allowFill: allowFill.value, ...(!previous || password.value ? { password: password.value } : {}) }
    : { url: url.value }
  const changeHost = !previous || hostChanged.value || hostId.value !== (previous.host?.id ?? null)
  const body = { label: label.value, ...(changeHost ? { hostId: hostId.value } : {}), ...details }
  const parsed = previous
    ? VaultSiteUpdateSchema.safeParse({ ...body, id: previous.id, version: previous.version })
    : VaultSiteCreateSchema.safeParse({ ...body, kind: kind.value, scope: scope.value, ...(scope.value === 'GROUP' ? { groupId: groupId.value } : {}) })
  if (!parsed.success || !hostAllowed || !scopeAllowed || (previous && !previous.canManage)) { error.value = t.value.invalid; return }
  busy.value = true
  try {
    if (previous) await props.client.update(VaultSiteUpdateSchema.parse(parsed.data))
    else await props.client.create(VaultSiteCreateSchema.parse(parsed.data))
    password.value = ''
    if (!alive) return
    releaseDraft()
    editing.value = false; selected.value = null; notice.value = t.value.saved; emit('saved'); await load()
    await nextTick(); if (alive && !editing.value) newItemButton.value?.focus()
  } catch (failure) {
    if (failure instanceof Error && 'reason' in failure && failure.reason === 'proofRequired') {
      if (!alive || !editing.value) return
      error.value = t.value.proof
      const boundOrigin = origin.value || captureOrigin.value
      if (boundOrigin) {
        const id = crypto.randomUUID(); armDraft(id)
        emit('proof-required', {
        id, expiresAt: draftDeadline, origin: boundOrigin, username: username.value, password: password.value,
        editor: { mode: previous ? 'update' : 'create', kind: kind.value, label: label.value, scope: scope.value,
          ...(scope.value === 'GROUP' && groupId.value ? { groupId: groupId.value } : {}),
          ...(previous ? { siteId: previous.id, version: previous.version } : {}),
          ...(changeHost ? { hostId: hostId.value } : {}), allowFill: allowFill.value,
          origins: kind.value === 'login' ? normalizedOrigins.value! : [], ...(kind.value === 'url' ? { url: url.value } : {}),
        },
      })
      }
      return
    }
    password.value = ''; if (alive) { releaseDraft(); error.value = t.value.failed }
  }
  finally { busy.value = false }
}
watch(kind, () => { password.value = '' }, { flush: 'sync' })
watch((): CapturedSiteDraft | null => props.capturedDraft, draft => {
  clearTimeout(pendingDraftTimer)
  if (!draft || draft.id === consumedId.value) return
  if (!editing.value && !busy.value) { useCapture(); return }
  const id = draft.id, remaining = draftExpiresAt(draft) - Date.now()
  pendingDraftTimer = setTimeout(() => { if (alive && pendingDraft.value?.id === id) discardCapture() }, Math.max(0, remaining))
}, { immediate: true })
onBeforeUnmount(() => { discardCapture(); clearTimeout(draftTimer); clearTimeout(pendingDraftTimer); stagedDraftId = ''; draftDeadline = 0; alive = false; preferenceEpoch++; generation++; username.value = ''; origins.value = ''; captureOrigin.value = ''; clearTimeout(searchTimer); clearTimeout(hostSearchTimer); password.value = '' })
</script>

<template>
  <section
    class="site-panel"
    :aria-label="t.title"
  >
    <header>
      <h2>{{ t.title }}</h2><button
        v-if="!editing"
        ref="newItemButton"
        type="button"
        @click="start()"
      >
        {{ t.add }}
      </button>
    </header>
    <p
      v-if="!fillEnabled"
      class="hint"
    >
      {{ t.pilot }}
    </p>
    <p role="status">
      {{ notice }}
    </p>
    <div
      v-if="pendingDraft"
      role="status"
    >
      <p>{{ t.pendingCapture }}</p>
      <button
        type="button"
        :disabled="busy"
        @click="useCapture"
      >
        {{ t.useCapture }}
      </button>
      <button
        type="button"
        @click="discardCapture"
      >
        {{ t.discard }}
      </button>
    </div>
    <p
      v-if="preferenceError"
      role="status"
    >
      {{ preferenceError }}
    </p>
    <form
      v-if="editing"
      autocomplete="off"
      :aria-busy="busy"
      @submit.prevent="save"
      @keydown.esc.stop.prevent="cancel"
    >
      <fieldset :disabled="busy">
        <template v-if="captureOrigin">
          <p role="status">
            {{ t.captured }} {{ captureOrigin }}
          </p>
          <label v-if="!restoredEditor">{{ t.target }}<select
            v-model="captureTarget"
            @change="selectCaptureTarget"
          >
            <option :value="null">{{ t.newLogin }}</option>
            <option
              v-for="item in captureCandidates"
              :key="item.id"
              :value="item.id"
            >{{ item.label }} — {{ item.username }}</option>
          </select></label>
        </template>
        <label v-if="!selected && !captureOrigin">{{ t.title }}<select v-model="kind"><option value="login">{{ t.login }}</option><option value="url">{{ t.url }}</option></select></label>
        <label>{{ t.name }}<input
          ref="nameField"
          v-model="label"
          required
          maxlength="160"
        ></label>
        <template v-if="kind === 'login'">
          <label>{{ t.username }}<input
            v-model="username"
            maxlength="320"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            @input="captureUsernameEdited = true"
          ></label>
          <label>{{ t.password }}<input
            v-model="password"
            type="password"
            :required="!selected"
            maxlength="16384"
            autocomplete="new-password"
            :aria-describedby="selected ? 'site-password-hint' : undefined"
          ></label>
          <p
            v-if="selected"
            id="site-password-hint"
            class="hint"
          >
            {{ t.preserve }}
          </p>
          <button
            type="button"
            @click="generate"
          >
            {{ t.generate }}
          </button>
          <details>
            <summary>{{ t.generatorOptions }}</summary>
            <label>{{ t.length }}<input
              v-model.number="generator.length"
              type="number"
              min="8"
              max="128"
              step="1"
            ></label>
            <label
              v-for="key in (['uppercase', 'lowercase', 'digits', 'symbols'] as const)"
              :key="key"
              class="check"
            ><input
              v-model="generator[key]"
              type="checkbox"
            >{{ t[key] }}</label>
          </details>
          <label>{{ t.origins }}<textarea
            v-model="origins"
            required
            rows="2"
            spellcheck="false"
            aria-describedby="site-websites-hint site-websites-preview"
          /></label>
          <p
            id="site-websites-hint"
            class="hint"
          >
            {{ t.sitesHint }}
          </p>
          <p
            id="site-websites-preview"
            role="status"
            class="hint"
          >
            <template v-if="normalizedOrigins?.length">
              {{ t.sitesPreview }} <strong>{{ normalizedOrigins.join(', ') }}</strong>
            </template>
          </p>
          <label class="check"><input
            v-model="allowFill"
            type="checkbox"
          >{{ t.allowFill }}</label>
        </template>
        <label v-else>{{ t.address }}<input
          v-model="url"
          required
          type="url"
          maxlength="2048"
          spellcheck="false"
        ></label>
        <label v-if="!selected && (writeAccess?.groups.length || writeAccess?.tenant)">{{ t.scope }}
          <select v-model="scope"><option value="PERSONAL">{{ t.personal }}</option><option
            v-if="writeAccess?.groups.length"
            value="GROUP"
          >{{ t.group }}</option><option
            v-if="writeAccess?.tenant"
            value="TENANT"
          >{{ t.tenant }}</option></select>
        </label>
        <label v-if="!selected && scope === 'GROUP'">{{ t.group }}<select
          v-model="groupId"
          required
        ><option
          :value="undefined"
          disabled
        >{{ t.group }}</option><option
          v-for="group in writeAccess?.groups"
          :key="group.id"
          :value="group.id"
        >{{ group.name }}</option></select></label>
        <label>{{ t.hostSearch }}<input
          v-model="hostSearch"
          type="search"
          maxlength="200"
        ></label>
        <label>{{ t.host }}<select
          v-model="hostId"
          @change="hostChanged = true"
        ><option :value="null">{{ t.none }}</option><option
          v-if="chosenHost && !hostOptions?.some(host => host.id === chosenHost?.id)"
          :value="chosenHost.id"
        >{{ chosenHost.name }}</option><option
          v-for="host in hostOptions"
          :key="host.id"
          :value="host.id"
        >{{ host.name }}</option></select></label>
        <div class="actions">
          <button
            type="submit"
            class="primary-action"
          >
            {{ t.save }}
          </button><button
            type="button"
            @click="cancel"
          >
            {{ t.cancel }}
          </button>
        </div>
      </fieldset>
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
    </form>
    <template v-else>
      <nav :aria-label="t.title">
        <button
          type="button"
          :aria-pressed="tab === 'current'"
          :disabled="!origin"
          @click="tab = 'current'"
        >
          {{ t.current }}
        </button><button
          type="button"
          :aria-pressed="tab === 'all'"
          @click="tab = 'all'"
        >
          {{ t.all }}
        </button>
      </nav>
      <label v-if="preferences">{{ t.title }}<select v-model="preferenceFilter">
        <option value="all">{{ t.allLoaded }}</option><option value="favorites">{{ t.favorites }}</option><option value="recent">{{ t.recent }}</option>
      </select></label>
      <label>{{ t.search }}<input
        v-model="search"
        type="search"
        maxlength="160"
      ></label>
      <p
        v-if="origin && tab === 'current'"
        class="hint"
      >
        {{ origin }}
      </p>
      <p
        v-if="loading"
        role="status"
      >
        {{ t.loading }}
      </p>
      <p
        v-if="loadError"
        role="alert"
      >
        {{ loadError }} <button
          type="button"
          @click="load(retryPage)"
        >
          {{ t.retry }}
        </button>
      </p>
      <p v-if="!loading && !loadError && !visible.length">
        {{ t.empty }}
      </p>
      <ul>
        <li
          v-for="item in visible"
          :key="item.id"
        >
          <strong>{{ item.label }}</strong><span v-if="item.username">{{ item.username }}</span>
          <div class="actions">
            <button
              v-if="preferences"
              type="button"
              :aria-label="`${t.favorite}: ${item.label}`"
              :aria-pressed="preferenceData.favorites.includes(item.id)"
              :disabled="preferenceBusy"
              @click="toggleFavorite(item)"
            >
              {{ t.favorite }}
            </button>
            <button
              v-if="canFill(item)"
              type="button"
              class="primary-action"
              :disabled="props.fillBusy"
              @click="fill(item)"
            >
              {{ t.fill }}
            </button><button
              type="button"
              @click="open(item)"
            >
              {{ t.open }}
            </button><button
              v-if="item.canManage"
              type="button"
              @click="start(item)"
            >
              {{ t.edit }}
            </button>
          </div>
          <button
            v-if="item.host"
            type="button"
            class="host"
            @click="connect(item)"
          >
            {{ t.connect }}: {{ item.host.name }}
          </button>
        </li>
      </ul>
      <button
        v-if="next !== null"
        type="button"
        :disabled="loading"
        @click="load(true)"
      >
        {{ t.more }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.site-panel { min-width: 0; width: 100%; box-sizing: border-box; color: inherit; font: inherit; }
header, nav, .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
header { justify-content: space-between; } h2 { font-size: 16px; margin: 8px 0; }
nav { padding: 3px; background: var(--surface, #f6f7f9); border-radius: 8px; gap: 4px; }
nav button { flex: 1; border-color: transparent; background: transparent; }
nav button[aria-pressed="true"] { color: var(--primary, #18a058); background: var(--bg, #fff); box-shadow: 0 1px 3px #00000012; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
label { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; font-size: 13px; }
input, textarea, select, button { font: inherit; box-sizing: border-box; max-width: 100%; }
input, textarea, select { width: 100%; padding: 8px; border: 1px solid var(--border, #d5d9df); border-radius: 6px; background: var(--bg, transparent); color: inherit; }
button { padding: 7px 10px; min-height: 34px; cursor: pointer; white-space: normal; overflow-wrap: anywhere; border: 1px solid var(--border, #d5d9df); border-radius: 6px; background: var(--surface, #f6f7f9); color: inherit; transition: background .12s; }
button:hover:not(:disabled) { border-color: var(--primary, #18a058); color: var(--primary, #18a058); }
.primary-action { background: var(--primary, #18a058); color: var(--primary-text, #fff); border-color: transparent; font-weight: 600; }
.primary-action:hover:not(:disabled) { background: var(--primary-hover, #36ad6a); color: var(--primary-text, #fff); }
button:disabled { cursor: default; opacity: .6; } :focus-visible { outline: 2px solid #4588ed; outline-offset: 2px; }
.check { flex-direction: row; align-items: center; } .check input { width: auto; }
ul { padding: 0; margin: 8px 0; list-style: none; } li { display: flex; flex-direction: column; gap: 7px; padding: 14px 0; border-bottom: 1px solid var(--border, #d5d9df); }
li strong, li span, p { overflow-wrap: anywhere; } li span { color: var(--muted, #5c6168); } .hint { font-size: 12px; color: var(--muted, #5c6168); } .host { text-align: left; background: transparent; font-size: 12px; }
p:empty { display: none; }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
