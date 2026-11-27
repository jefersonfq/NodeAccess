<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { VaultItemKind, VaultItemSummary } from '@nodeaccess/shared'
import { ExtensionError, type ExtensionClient, type ExtensionFailure } from '../core/client'
import { message } from './messages'
import type { UpdateCheck } from '../core/update'
import PopupIcon from './PopupIcon.vue'
import ItemEditor from './ItemEditor.vue'
import SitePanel from './SitePanel.vue'
import { readPendingFill, type PendingFillIntent, type PendingFillPort, type CapturedSiteDraft, type CapturedDraftPort, type SiteAssistPort } from '../core/portal-fill-intent'
import type { SitePreferences, SitePreferencesPort } from '../core/site-preferences'
import { vaultSiteUrl, type VaultSiteMetadata } from '@nodeaccess/shared'

/** `update` (NA-0190, local builds): whether the portal announces a newer build on disk, and how to reload it. */
const props = defineProps<{ client: ExtensionClient; requestConnection: () => Promise<{ ok: boolean; reason?: ExtensionFailure }>; open: (url: string) => Promise<unknown>
  update?: { check: UpdateCheck; apply: () => void }
  /** NA-0190: reason of a connection attempt that failed after the popup closed (read once). */
  lastFailure?: () => Promise<ExtensionFailure | null>
  /** NA-0192: browser language, used until a connection tells the portal's (default pt-BR). */
  browserLanguage?: string
  currentSite?: () => Promise<string>
  pendingFill?: PendingFillPort
  capturedDraftPort?: CapturedDraftPort
  siteAssist?: SiteAssistPort
  preferenceFactory?: (scope: string, kind: 'sites' | 'hosts') => SitePreferencesPort
  requestSiteFill?: (id: number, version: number, origin: string) => Promise<{ ok: boolean; reason?: ExtensionFailure }>
}>()
const language = ref(props.browserLanguage ?? 'pt-BR')
const showSites = ref(false), siteOrigin = ref(''), sitesEnabled = ref(false), fillEnabled = ref(false)
const siteHosts = ref<Array<{ id: number; name: string }>>([]), siteBusy = ref(false), siteMessage = ref(''), siteNeedsProof = ref(false)
const currentHosts = ref<Array<{ id: number; name: string }>>([])
const pendingSiteFill = ref<PendingFillIntent | null>(null), fillReady = ref(false)
const capturedDraft = ref<CapturedSiteDraft | null>(null), captureOptIn = ref(false), assistBusy = ref(false)
const sitePreferences = ref<SitePreferencesPort>(), hostPreferences = ref<SitePreferencesPort>()
const hostPreferenceState = ref<SitePreferences>({ favorites: [], recents: [] }), preferenceScope = ref('')
let fillTimer: ReturnType<typeof setTimeout> | undefined, fillCheckBusy = false
let editorProofTimer: ReturnType<typeof setTimeout> | undefined, editorProofDeadline = 0, stagedDraftId = '', editorProofBusy = false
const editorProofState = ref<'idle' | 'waiting' | 'ready'>('idle')
function clearSiteContinuity(): void {
  clearTimeout(fillTimer); clearTimeout(editorProofTimer); stagedDraftId = ''; editorProofState.value = 'idle'; pendingSiteFill.value = null; fillReady.value = false; capturedDraft.value = null; captureOptIn.value = false
}
function orderedHosts(hosts: Array<{ id: number; name: string }>): Array<{ id: number; name: string }> {
  const score = (id: number): number => hostPreferenceState.value.favorites.includes(id) ? 2 : hostPreferenceState.value.recents.some(h => h.id === id) ? 1 : 0
  return [...hosts].sort((a, b) => score(b.id) - score(a.id))
}
async function favoriteHost(id: number): Promise<void> {
  if (!hostPreferences.value || ![...currentHosts.value, ...(related.value?.hosts ?? [])].some(h => h.id === id)) return
  const run = siteRun
  try { const value = await hostPreferences.value.favorite(id, !hostPreferenceState.value.favorites.includes(id)); if (run === siteRun && phase.value === 'connected') hostPreferenceState.value = value } catch { /* Preferences never grant access. */ }
}
function consumedDraft(id: string): void {
  if (capturedDraft.value?.id === id) capturedDraft.value = null
  if (stagedDraftId === id) { stagedDraftId = ''; clearTimeout(editorProofTimer); editorProofState.value = 'idle'; void props.capturedDraftPort?.clear().catch(() => {}) }
}
async function checkEditorProof(): Promise<void> {
  if (editorProofState.value !== 'waiting' || phase.value !== 'connected' || pendingSiteFill.value) return
  const run = siteRun
  if (Date.now() >= editorProofDeadline) { editorProofState.value = 'idle'; void props.capturedDraftPort?.clear().catch(() => {}); return }
  try {
    const result = await props.client.claimPortalProof()
    if (run !== siteRun || phase.value !== 'connected' || editorProofState.value !== 'waiting') return
    if (result.state === 'approved') { proofUntil.value = result.proofUntil; editorProofState.value = 'ready'; return }
    if (result.state === 'none') { editorProofState.value = 'idle'; return }
    editorProofTimer = setTimeout(() => { void checkEditorProof() }, 1500)
  } catch { if (run === siteRun) siteMessage.value = message(language.value).errors.unavailable }
}
async function stageEditorProof(draft: CapturedSiteDraft): Promise<void> {
  if (!props.capturedDraftPort || phase.value !== 'connected' || editorProofBusy) return
  const run = siteRun; stagedDraftId = draft.id; editorProofBusy = true
  try {
    if (pendingSiteFill.value) await cancelSiteFill()
    await props.capturedDraftPort.stage(draft)
    if (run !== siteRun || phase.value !== 'connected' || stagedDraftId !== draft.id) { await props.capturedDraftPort.clear(); return }
    const url = await props.client.requestPortalProof()
    if (run !== siteRun || phase.value !== 'connected' || stagedDraftId !== draft.id) return
    editorProofState.value = 'waiting'; editorProofDeadline = Date.now() + 120_000
    await props.open(url)
    await checkEditorProof()
  } catch { if (run === siteRun) siteMessage.value = message(language.value).errors.unavailable }
  finally { editorProofBusy = false }
}
async function enableSiteAssist(): Promise<void> {
  if (!props.siteAssist || assistBusy.value || phase.value !== 'connected') return
  const run = siteRun; assistBusy.value = true; siteMessage.value = ''
  try {
    const result = await props.siteAssist.enable({ capture: captureOptIn.value })
    if (run === siteRun && phase.value === 'connected') siteMessage.value = result.ok
      ? (language.value.startsWith('pt') ? 'Assistência ativada neste site. Escolha um login; a extensão pedirá confirmação.' : 'Assistance enabled on this site. Choose a login; the extension will ask for confirmation.') : message(language.value).errors.unavailable
  } catch { if (run === siteRun) siteMessage.value = message(language.value).errors.unavailable }
  finally { if (run === siteRun) assistBusy.value = false }
}
async function cancelSiteFill(): Promise<void> {
  clearTimeout(fillTimer); pendingSiteFill.value = null; fillReady.value = false; siteNeedsProof.value = false
  await props.pendingFill?.cancel().catch(() => {})
}
async function checkSiteFill(): Promise<void> {
  if (!props.pendingFill || fillCheckBusy || !pendingSiteFill.value || phase.value !== 'connected') return
  if (!readPendingFill(pendingSiteFill.value)) { await cancelSiteFill(); siteMessage.value = language.value.startsWith('pt') ? 'A seleção expirou. Escolha o login novamente.' : 'Selection expired. Choose the login again.'; return }
  fillCheckBusy = true; const run = siteRun, reference = pendingSiteFill.value.reference
  try {
    const result = await props.pendingFill.check()
    if (run !== siteRun || phase.value !== 'connected' || pendingSiteFill.value?.reference !== reference) return
    const value = result.state === 'none' ? null : readPendingFill(result.pending)
    pendingSiteFill.value = value; fillReady.value = !!value && result.state === 'ready'
    siteNeedsProof.value = !!value && !fillReady.value
    if (value) {
      siteOrigin.value = value.origin
      clearTimeout(fillTimer)
      fillTimer = setTimeout(() => { void checkSiteFill() }, fillReady.value ? Math.max(1, value.expiresAt - Date.now()) : 1500)
    } else siteMessage.value = language.value.startsWith('pt') ? 'O contexto mudou. Escolha o login novamente.' : 'The context changed. Choose the login again.'
  } catch { if (run === siteRun) siteMessage.value = message(language.value).errors.unavailable }
  finally { fillCheckBusy = false }
}
async function restoreSiteContinuity(): Promise<boolean> {
  if (phase.value !== 'connected') return false
  const run = siteRun
  const [pending, draft] = await Promise.all([props.pendingFill?.get().catch(() => null) ?? null, props.capturedDraftPort?.take().catch(() => null) ?? null])
  if (run !== siteRun || phase.value !== 'connected') return false
  const value = readPendingFill(pending)
  if (draft) {
    capturedDraft.value = draft; siteOrigin.value = draft.origin; showSites.value = true
    if (draft.editor && !value) { editorProofState.value = 'waiting'; editorProofDeadline = Math.min(draft.expiresAt ?? Infinity, Date.now() + 120_000); void checkEditorProof() }
  }
  if (!value) return !!draft?.editor
  pendingSiteFill.value = value; siteOrigin.value = value.origin; showSites.value = true
  await checkSiteFill(); return true
}
async function confirmSiteFill(): Promise<void> {
  const value = readPendingFill(pendingSiteFill.value)
  if (!value || !fillReady.value || !props.pendingFill || siteBusy.value || phase.value !== 'connected') return
  const run = siteRun; siteBusy.value = true; clearTimeout(fillTimer)
  try {
    const result = await props.pendingFill.consume(value.reference)
    if (run !== siteRun || phase.value !== 'connected' || pendingSiteFill.value?.reference !== value.reference) return
    pendingSiteFill.value = null; fillReady.value = false; siteNeedsProof.value = false
    siteMessage.value = result.ok ? (language.value.startsWith('pt') ? 'Login preenchido. Confira e entre no site.' : 'Login filled. Review and sign in.') : message(language.value).errors[result.reason ?? 'unavailable']
  } catch { if (run === siteRun) siteMessage.value = message(language.value).errors.unavailable }
  finally { if (run === siteRun) siteBusy.value = false }
}
onBeforeUnmount(() => { siteRun++; clearSiteContinuity() })
let hostSearchRun = 0
async function searchSiteHosts(q: string): Promise<void> {
  const run = ++hostSearchRun, session = siteRun
  const hosts = await props.client.siteHosts?.(q).catch(() => []) ?? []
  if (run === hostSearchRun && session === siteRun && phase.value === 'connected') siteHosts.value = hosts
}
let siteRun = 0
async function openSites(): Promise<void> {
  currentHosts.value = []; siteHosts.value = []
  showSites.value = true; forget(); closeHosts()
  const run = ++siteRun
  const [origin, hosts] = await Promise.all([props.currentSite?.().catch(() => '') ?? '', props.client.siteHosts?.().catch(() => []) ?? []])
  if (run !== siteRun || phase.value !== 'connected') return
  siteOrigin.value = origin; siteHosts.value = hosts
  currentHosts.value = []
  if (origin) {
    const matches = await props.client.siteCurrentHosts?.(origin).catch(() => []) ?? []
    if (run === siteRun && phase.value === 'connected') currentHosts.value = matches
  }
}
async function fillLogin(item: VaultSiteMetadata): Promise<void> {
  if (siteBusy.value || !props.requestSiteFill || !fillEnabled.value || !item.origins.includes(siteOrigin.value)) return
  const run = siteRun; siteBusy.value = true; siteMessage.value = ''; siteNeedsProof.value = false
  try {
    const result = await props.requestSiteFill(item.id, item.version, siteOrigin.value)
    if (run !== siteRun || phase.value !== 'connected') return
    siteNeedsProof.value = result.reason === 'proofRequired'
    if (siteNeedsProof.value && props.pendingFill) { const value = await props.pendingFill.get(); if (run !== siteRun || phase.value !== 'connected') return; pendingSiteFill.value = readPendingFill(value); fillReady.value = false }
    siteMessage.value = result.ok ? (language.value.startsWith('pt') ? 'Login preenchido. Confira e entre no site.' : 'Login filled. Review and sign in.')
      : message(language.value).errors[result.reason ?? 'unavailable']
  } catch { if (run === siteRun) siteMessage.value = message(language.value).errors.unavailable }
  finally { if (run === siteRun) siteBusy.value = false }
}
async function siteProof(): Promise<void> {
  try {
    const url = pendingSiteFill.value && props.pendingFill ? (await props.pendingFill.beginProof()).url : await props.client.requestPortalProof()
    await props.open(url)
    if (pendingSiteFill.value) await checkSiteFill()
  } catch (failure) { fail(failure) }
}
async function openWebsite(url: string): Promise<void> { try { await props.open(vaultSiteUrl(url)) } catch { siteMessage.value = message(language.value).errors.invalid } }
const writeAccess = ref<{ groups: Array<{ id: number; name: string }>; tenant: boolean }>({ groups: [], tenant: false })
const editor = ref<{ mode: 'create-secret' | 'update-secret' | 'rotate-secret' | 'import-pem'; item?: VaultItemSummary } | null>(null)
const saved = ref(false)
const hostWords = computed(() => language.value.toLowerCase().startsWith('pt')
  ? { title: 'Hosts associados', loading: 'Carregando hosts…', empty: 'Nenhum host disponível para você.', more: 'Mostrar mais', retry: 'Tentar novamente' }
  : { title: 'Associated hosts', loading: 'Loading hosts…', empty: 'No hosts available to you.', more: 'Show more', retry: 'Try again' })
const related = ref<{ key: string; hosts: Array<{ id: number; name: string }>; cursor: string | null; loading: boolean; error: string } | null>(null)
let hostRun = 0
function closeHosts(): void { hostRun++; related.value = null }
async function loadHosts(item: VaultItemSummary, more = false): Promise<void> {
  const key = `${item.kind}:${item.sourceId}`
  if (related.value?.loading) return
  if (!more) related.value = { key, hosts: [], cursor: null, loading: true, error: '' }
  if (!related.value || related.value.key !== key) return
  const current = ++hostRun, cursor = more ? related.value.cursor ?? undefined : undefined
  related.value.loading = true; related.value.error = ''
  try {
    const answer = await props.client.hosts(item.kind, item.sourceId, cursor)
    if (current !== hostRun || !related.value) return
    related.value.hosts = more ? [...related.value.hosts, ...answer.hosts] : answer.hosts
    related.value.cursor = answer.nextCursor
  } catch (failure) {
    if (current !== hostRun || !related.value) return
    const reason = failure instanceof ExtensionError ? failure.reason : 'unavailable'
    if (reason === 'expired' || reason === 'denied') fail(failure)
    else related.value.error = message(language.value).errors[reason]
  } finally { if (current === hostRun && related.value) related.value.loading = false }
}
function toggleHosts(item: VaultItemSummary): void { if (related.value?.key === `${item.kind}:${item.sourceId}`) closeHosts(); else { closeHosts(); void loadHosts(item) } }
async function openHost(id: number): Promise<void> {
  try {
    const run = siteRun
    await props.open(props.client.portalUrl(`/hosts?hostId=${id}&connect=1`))
    const value = await hostPreferences.value?.used(id).catch(() => null)
    if (value && run === siteRun && phase.value === 'connected') hostPreferenceState.value = value
  } catch (failure) { fail(failure) }
}
onBeforeUnmount(closeHosts)
const editLabels = computed(() => language.value.toLowerCase().startsWith('pt')
  ? { create: 'Novo Secret', pem: 'Importar PEM', edit: 'Editar dados', rotate: 'Trocar senha', saved: 'Item salvo.' }
  : { create: 'New Secret', pem: 'Import PEM', edit: 'Edit details', rotate: 'Replace password', saved: 'Item saved.' })
function edit(mode: 'create-secret' | 'update-secret' | 'rotate-secret' | 'import-pem', item?: VaultItemSummary): void {
  if (!features.value.create || (item && (item.kind !== 'secret' || !(item.writable ?? item.scope === 'personal')))) return
  closeHosts(); forget(); cancelProof(); saved.value = false
  editor.value = { mode, ...(item ? { item } : {}) }
}
function closeEditor(): void { editor.value = null; void nextTick(() => searchInput.value?.focus()) }
async function itemSaved(): Promise<void> { closeEditor(); saved.value = true; await search() }
const t = computed(() => message(language.value))
/** `code` (NA-0193): trusted device whose portal login ended — only the authenticator code is asked. */
const phase = ref<'loading' | 'disconnected' | 'connecting' | 'code' | 'connected'>('loading')
watch(phase, value => { if (value !== 'connected') { siteRun++; clearSiteContinuity(); hostPreferenceState.value = { favorites: [], recents: [] }; sitePreferences.value = undefined; hostPreferences.value = undefined; preferenceScope.value = ''; void props.pendingFill?.cancel().catch(() => {}); void props.capturedDraftPort?.clear().catch(() => {}); void props.siteAssist?.cancel().catch(() => {}); showSites.value = false; siteOrigin.value = ''; siteHosts.value = []; currentHosts.value = []; siteBusy.value = false; siteMessage.value = ''; siteNeedsProof.value = false } }, { flush: 'sync' })
const otp = ref(''), renewing = ref(false)
const query = ref(''), kind = ref<VaultItemKind | ''>(''), items = ref<VaultItemSummary[]>([]), next = ref<string | null>(null)
const fingerprint = ref(''), updateAvailable = ref(false)
const recents = ref<string[]>([]), error = ref<ExtensionFailure | 'trustEnded' | ''>(''), searching = ref(false)
const kinds = computed((): Array<{ value: VaultItemKind | ''; label: string }> => [{ value: '', label: t.value.all }, { value: 'secret', label: t.value.secret }, { value: 'pem', label: t.value.pem }])
// NA-0192: search as you type and keyboard navigation of the results.
const searchInput = ref<HTMLInputElement | null>(null), itemButtons = ref<HTMLButtonElement[]>([]), active = ref(-1)
let typing: ReturnType<typeof setTimeout> | undefined
const busy = computed(() => searching.value && !items.value.length)
const recentItems = computed(() => recents.value.map(key => items.value.find(i => `${i.kind}:${i.sourceId}` === key)).filter((i): i is VaultItemSummary => !!i))
let generation = 0

function fail(failure: unknown): void {
  closeHosts()
  const reason = failure instanceof ExtensionError ? failure.reason : 'unavailable'
  forget()
  error.value = reason
  if (reason === 'expired' || reason === 'denied') { resumed.value = null; stopPortal(); editor.value = null; phase.value = 'disconnected'; items.value = [] }
}
async function search(more = false): Promise<void> {
  closeHosts()
  clearTimeout(typing)
  const current = ++generation
  searching.value = true; error.value = ''
  try {
    const reply = await props.client.search(query.value, kind.value || undefined, more ? next.value ?? undefined : undefined)
    if (current !== generation) return
    items.value = more ? [...items.value, ...reply.items] : reply.items
    next.value = reply.nextCursor
    if (!more) active.value = -1
  } catch (failure) { if (current === generation) fail(failure) } finally { if (current === generation) searching.value = false }
}
function setKind(value: VaultItemKind | ''): void {
  if (kind.value === value) return
  kind.value = value
  void search()
}
watch(query, () => {
  if (phase.value !== 'connected') return
  clearTimeout(typing)
  typing = setTimeout(() => { void search() }, 300)
})
async function useLocale(): Promise<void> {
  const locale = await props.client.locale().catch(() => null)
  if (locale) language.value = locale
}
function focusItem(index: number): void {
  if (!items.value.length) return
  active.value = Math.max(0, Math.min(items.value.length - 1, index))
  void nextTick(() => itemButtons.value[active.value]?.focus())
}
/** `/` focuses the search; ↑/↓ move through the results; Esc clears the search (Enter on an item opens it). */
function onKey(event: KeyboardEvent): void {
  if (showSites.value) return
  if (phase.value !== 'connected' || editor.value) return
  const inSearch = event.target === searchInput.value
  if (event.key === '/' && !inSearch) { event.preventDefault(); searchInput.value?.focus(); return }
  if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(inSearch ? 0 : active.value + 1); return }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (active.value <= 0) { active.value = -1; searchInput.value?.focus() } else focusItem(active.value - 1)
    return
  }
  if (event.key === 'Escape' && query.value) { event.preventDefault(); query.value = ''; searchInput.value?.focus() }
}
// The popup page is the whole document; `globalThis` keeps the component testable outside a browser.
onMounted(() => { globalThis.addEventListener?.('keydown', onKey) })
onBeforeUnmount(() => { globalThis.removeEventListener?.('keydown', onKey); clearTimeout(typing) })
async function connect(): Promise<void> {
  phase.value = 'connecting'; error.value = ''
  fingerprint.value = await props.client.fingerprint().catch(() => '')
  const reply = await props.requestConnection().catch(() => ({ ok: false, reason: 'unavailable' as const }))
  if (!reply.ok) { phase.value = 'disconnected'; error.value = reply.reason ?? 'unavailable'; return }
  phase.value = 'connected'
  await useLocale()
  await search()
  void loadFeatures()
}
/** NA-0193: reconnect a trusted device; `null` = automatic. Ends in `connected`, `code` or `disconnected`. */
async function renew(code: string | null): Promise<boolean> {
  renewing.value = true
  try {
    await props.client.renew(code ?? undefined)
    otp.value = ''; error.value = ''; phase.value = 'connected'
    await useLocale()
    recents.value = await props.client.recents()
    await search()
    void loadFeatures()
    return true
  } catch (failure) {
    const reason = failure instanceof ExtensionError ? failure.reason : 'unavailable'
    if (reason === 'reauthRequired') phase.value = 'code'
    else if (reason === 'otpInvalid') { phase.value = 'code'; error.value = 'otpInvalid'; otp.value = '' }
    else if (code !== null) { phase.value = 'disconnected'; error.value = reason === 'expired' ? 'trustEnded' : reason }
    else phase.value = 'disconnected'
    return false
  } finally { renewing.value = false }
}
async function submitCode(): Promise<void> {
  if (renewing.value || !/^\d{6}$/.test(otp.value)) return
  await renew(otp.value)
}
async function disconnect(): Promise<void> {
  siteRun++; clearSiteContinuity()
  void props.pendingFill?.cancel().catch(() => {}); void props.capturedDraftPort?.clear().catch(() => {}); void props.siteAssist?.cancel().catch(() => {})
  closeHosts()
  resumed.value = null; stopPortal()
  editor.value = null; saved.value = false
  ++releases; forget(); pending.value = null; proofUntil.value = 0
  ++generation
  await props.client.disconnect()
  items.value = []; recents.value = []; query.value = ''; phase.value = 'disconnected'
}
// NA-0195 (E2): reveal/copy of secrets. The value lives only in memory, is shown for 15 s or copied on a second gesture.
const features = ref({ reveal: false, copy: false, create: false }), proofUntil = ref(0), proofOtp = ref('')
const pending = ref<{ item: VaultItemSummary; action: 'reveal' | 'copy' } | null>(null), working = ref('')
const revealed = ref<{ key: string; value: string } | null>(null), copyReady = ref<{ key: string; value: string } | null>(null), copiedKey = ref('')
let hideTimer: ReturnType<typeof setTimeout> | undefined
const keyOf = (item: VaultItemSummary): string => `${item.kind}:${item.sourceId}`
function forget(): void { clearTimeout(hideTimer); revealed.value = null; copyReady.value = null }
let releases = 0
async function loadFeatures(): Promise<void> {
  const run = siteRun
  try {
    const caps = await props.client.capabilities()
    if (run !== siteRun || phase.value !== 'connected') return
    if (!caps.preferenceScope && preferenceScope.value) { siteRun++; clearSiteContinuity(); showSites.value = false; currentHosts.value = []; closeHosts(); preferenceScope.value = ''; sitePreferences.value = undefined; hostPreferences.value = undefined; hostPreferenceState.value = { favorites: [], recents: [] } }
    if (caps.preferenceScope && props.preferenceFactory && preferenceScope.value !== caps.preferenceScope) {
      if (preferenceScope.value) { clearSiteContinuity(); siteRun++; currentHosts.value = []; closeHosts(); showSites.value = false }
      preferenceScope.value = caps.preferenceScope
      sitePreferences.value = props.preferenceFactory(caps.preferenceScope, 'sites')
      hostPreferences.value = props.preferenceFactory(caps.preferenceScope, 'hosts')
      const identity = caps.preferenceScope
      hostPreferenceState.value = { favorites: [], recents: [] }
      const prefs = await hostPreferences.value.load().catch(() => ({ favorites: [], recents: [] }))
      if (preferenceScope.value !== identity || phase.value !== 'connected') return
      hostPreferenceState.value = prefs
    }
    writeAccess.value = caps.writeAccess ?? { groups: [], tenant: false }
    features.value = { reveal: caps.features.reveal, copy: caps.features.copy, create: caps.features.create }
    sitesEnabled.value = caps.features.sites === true && !!props.client.sites
    fillEnabled.value = caps.features.fill === true
    if (sitesEnabled.value && props.currentSite && !siteOrigin.value) {
      const origin = await props.currentSite().catch(() => '')
      if (origin && phase.value === 'connected') { siteOrigin.value = origin; await openSites() }
    }
    proofUntil.value = caps.proofUntil ? Date.now() + caps.proofUntil - caps.serverNow : 0
  } catch (failure) {
    if (run !== siteRun || phase.value !== 'connected') return
    features.value = { reveal: false, copy: false, create: false }; sitesEnabled.value = false; fillEnabled.value = false
    siteRun++; clearSiteContinuity(); showSites.value = false; currentHosts.value = []; siteHosts.value = []
    hostPreferenceState.value = { favorites: [], recents: [] }; sitePreferences.value = undefined; hostPreferences.value = undefined; preferenceScope.value = ''
    if (failure instanceof ExtensionError && (failure.reason === 'expired' || failure.reason === 'denied')) fail(failure)
  }
}
async function release(item: VaultItemSummary, action: 'reveal' | 'copy'): Promise<void> {
  forget(); copiedKey.value = ''; error.value = ''; working.value = `${keyOf(item)}:${action}`
  const current = ++releases
  try {
    const value = await props.client.deliver(item.sourceId, action)
    // A reply that arrives after a disconnect or a newer request is dropped.
    if (current !== releases || phase.value !== 'connected') return
    if (action === 'reveal') revealed.value = { key: keyOf(item), value }
    else copyReady.value = { key: keyOf(item), value }
    hideTimer = setTimeout(forget, 15_000)
  } catch (failure) {
    const reason = failure instanceof ExtensionError ? failure.reason : 'unavailable'
    if (reason === 'proofRequired') { proofUntil.value = 0; pending.value = { item, action } } else fail(failure)
  } finally { working.value = '' }
}
async function act(item: VaultItemSummary, action: 'reveal' | 'copy'): Promise<void> {
  if (item.kind !== 'secret' || working.value) return
  resumed.value = null
  if (proofUntil.value <= Date.now()) { pending.value = { item, action }; proofOtp.value = ''; return }
  await release(item, action)
}
async function confirmProof(): Promise<void> {
  const target = pending.value
  if (!target || working.value || !/^\d{6}$/.test(proofOtp.value)) return
  working.value = 'proof'; error.value = ''
  try {
    proofUntil.value = await props.client.unlock(proofOtp.value)
    pending.value = null; proofOtp.value = ''; working.value = ''
    await release(target.item, target.action)
  } catch (failure) {
    working.value = ''; proofOtp.value = ''
    fail(failure)
  }
}
function cancelProof(): void {
  pending.value = null; proofOtp.value = ''; resumed.value = null; stopPortal()
  void props.client.cancelPortalProof().catch(() => {})
}
/**
 * NA-0200 (E5b, SEC-16): the proof may come from the portal (Windows Hello or password + code). Opening the portal tab
 * usually closes this popup; when it reopens, an approved request restores the proof and a freshly authorized item.
 * The person selects Resume — nothing runs by itself after the popup was lost. While the popup stays open, it polls and
 * continues with the pending action.
 */
const portal = ref<'idle' | 'waiting' | 'ready'>('idle')
const resumed = ref<{ item: VaultItemSummary; action: 'reveal' | 'copy' } | null>(null)
let portalTimer: ReturnType<typeof setTimeout> | undefined, portalRun = 0
let checkingPortal = false
function stopPortal(): void { clearTimeout(portalTimer); portalRun++; if (portal.value === 'waiting') portal.value = 'idle' }
async function checkPortal(continueWith?: { item: VaultItemSummary; action: 'reveal' | 'copy' }): Promise<boolean> {
  if (checkingPortal) return false
  checkingPortal = true
  const run = portalRun
  try {
    const result = await props.client.claimPortalProof()
    if (run !== portalRun || phase.value !== 'connected') return true
    if (result.state === 'approved') {
      clearTimeout(portalTimer); portalRun++
      proofUntil.value = result.proofUntil; portal.value = continueWith ? 'idle' : 'ready'
      if (!continueWith && result.resume) {
        resumed.value = result.resume
        items.value = [result.resume.item, ...items.value.filter(i => keyOf(i) !== keyOf(result.resume!.item))]
      }
      if (continueWith && pending.value === continueWith) { pending.value = null; await release(continueWith.item, continueWith.action) }
      return true
    }
    portal.value = result.state === 'pending' ? 'waiting' : 'idle'
    return result.state !== 'pending'
  } catch (failure) {
    if (run !== portalRun || phase.value !== 'connected') return true
    clearTimeout(portalTimer); portalRun++
    portal.value = failure instanceof ExtensionError && (failure.reason === 'unavailable' || failure.reason === 'quota') ? 'waiting' : 'idle'
    fail(failure); return true
  } finally { checkingPortal = false }
}
async function confirmInPortal(): Promise<void> {
  const target = pending.value
  if (!target || working.value) return
  working.value = 'portal'; error.value = ''
  const run = ++portalRun, started = Date.now()
  let url: string
  try { url = await props.client.requestPortalProof({ sourceId: target.item.sourceId, action: target.action }) } catch (failure) { working.value = ''; fail(failure); return }
  if (run !== portalRun || phase.value !== 'connected' || pending.value !== target) {
    working.value = ''; await props.client.cancelPortalProof(); return
  }
  working.value = ''; portal.value = 'waiting'
  const poll = async (): Promise<void> => {
    if (run !== portalRun) return
    if (await checkPortal(target) || run !== portalRun) return
    if (Date.now() - started > 120_000) { cancelProof(); error.value = 'portalProofExpired'; return }
    portalTimer = setTimeout(() => { void poll() }, 2_000)
  }
  portalTimer = setTimeout(() => { void poll() }, 2_000)
  try { await props.open(url) } catch (failure) { cancelProof(); fail(failure) }
}
onBeforeUnmount(() => { clearTimeout(portalTimer); portalRun++ })
/** Second gesture: the clipboard write happens inside the user's click. */
async function confirmCopy(): Promise<void> {
  const ready = copyReady.value
  if (!ready) return
  try { await navigator.clipboard.writeText(ready.value); copiedKey.value = ready.key } catch { error.value = 'unavailable' } finally { copyReady.value = null }
}
onBeforeUnmount(() => { forget() })
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
  await useLocale()
  // NA-0195: the footer names this device as the portal lists it (Connected devices), so a revoke is unambiguous.
  fingerprint.value = await props.client.fingerprint().catch(() => '')
  if (!await props.client.connected()) {
    const failure = await props.lastFailure?.().catch(() => null)
    // A connection attempt that just failed is explained instead of being retried silently.
    if (failure) { phase.value = 'disconnected'; if (!error.value) error.value = failure; return }
    await renew(null)
    return
  }
  phase.value = 'connected'
  await useLocale()
  recents.value = await props.client.recents()
  await search()
  await loadFeatures()
  if (!await restoreSiteContinuity()) void checkPortal()
})
defineExpose({ checkEditorProof, restoreSiteContinuity, checkSiteFill, confirmSiteFill, cancelSiteFill, stageEditorProof, enableSiteAssist, consumedDraft, favoriteHost, search, connect, disconnect, openItem, setKind, applyUpdate, onKey, focusItem, renew, submitCode, act, confirmProof, cancelProof, confirmCopy, loadFeatures, confirmInPortal, checkPortal, stopPortal, edit, closeEditor, itemSaved, loadHosts, closeHosts, toggleHosts, openHost })
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

    <div
      v-if="portal === 'ready'"
      class="update"
      role="status"
      data-testid="vaultnaccess-portal-ready"
    >
      {{ t.portalReady }}
      <button
        v-if="resumed && phase === 'connected'"
        type="button"
        class="update-button"
        :disabled="!!working"
        data-testid="vaultnaccess-resume"
        @click="act(resumed.item, resumed.action)"
      >
        {{ resumed.action === 'reveal' ? t.reveal : t.copy }}: {{ resumed.item.label }}
      </button>
    </div>
    <div
      v-else-if="portal === 'waiting'"
      class="update"
      role="status"
      data-testid="vaultnaccess-portal-waiting"
    >
      <span>{{ t.portalWaiting }}</span>
      <button
        type="button"
        class="update-button"
        @click="checkPortal()"
      >
        {{ t.portalCheck }}
      </button>
      <button
        type="button"
        class="link"
        @click="cancelProof"
      >
        {{ t.cancel }}
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
      v-else-if="phase === 'code'"
      class="welcome"
      data-testid="vaultnaccess-code"
    >
      <span
        class="hero"
        aria-hidden="true"
      ><PopupIcon name="lock" /></span>
      <p class="intro">
        {{ t.codeIntro }}
      </p>
      <form
        class="code-form"
        autocomplete="off"
        @submit.prevent="submitCode"
      >
        <label
          for="vaultnaccess-otp"
          class="code-label"
        >{{ t.codeLabel }}</label>
        <input
          id="vaultnaccess-otp"
          v-model="otp"
          class="code-input"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          pattern="[0-9]{6}"
          data-testid="vaultnaccess-otp"
        >
        <button
          type="submit"
          class="primary"
          :disabled="renewing || !/^[0-9]{6}$/.test(otp)"
          data-testid="vaultnaccess-otp-submit"
        >
          <span
            v-if="renewing"
            class="spinner"
            aria-hidden="true"
          />
          {{ t.codeSubmit }}
        </button>
      </form>
      <span class="code-links">
        <button
          type="button"
          class="link"
          data-testid="vaultnaccess-use-portal"
          @click="connect"
        >
          {{ t.usePortal }}
        </button>
        <button
          type="button"
          class="link"
          data-testid="vaultnaccess-code-disconnect"
          @click="disconnect"
        >
          {{ t.disconnect }}
        </button>
      </span>
    </section>

    <ItemEditor
      v-else-if="phase === 'connected' && editor"
      :client="client"
      :language="language"
      :mode="editor.mode"
      :write-access="writeAccess"
      :item="editor.item"
      @close="closeEditor"
      @saved="itemSaved"
      @expired="fail"
    />
    <section
      v-else-if="phase === 'connected'"
      class="connected"
    >
      <nav
        v-if="sitesEnabled"
        class="actions"
        aria-label="Vault sections"
        data-site-sections
      >
        <button
          type="button"
          class="link"
          :aria-pressed="showSites"
          @click="openSites"
        >
          Sites
        </button>
        <button
          type="button"
          class="link"
          :aria-pressed="!showSites"
          @click="showSites = false"
        >
          {{ language.startsWith('pt') ? 'Secrets e chaves' : 'Secrets and keys' }}
        </button>
      </nav>
      <template v-if="showSites && props.client.sites">
        <aside
          v-if="currentHosts.length"
          class="host-list"
        >
          <p>{{ language.startsWith('pt') ? 'Hosts deste site' : 'Hosts for this site' }}</p>
          <div
            v-for="host in orderedHosts(currentHosts)"
            :key="host.id"
            class="actions"
          >
            <button
              type="button"
              class="link"
              @click="openHost(host.id)"
            >
              {{ language.startsWith('pt') ? 'Conectar pelo NodeAccess' : 'Connect with NodeAccess' }} · {{ host.name }}
            </button>
            <button
              v-if="hostPreferences"
              type="button"
              class="link"
              :aria-label="`${language.startsWith('pt') ? 'Favorito' : 'Favorite'}: ${host.name}`"
              :aria-pressed="hostPreferenceState.favorites.includes(host.id)"
              @click="favoriteHost(host.id)"
            >
              {{ hostPreferenceState.favorites.includes(host.id) ? '★' : '☆' }}
            </button>
            <small v-if="hostPreferenceState.recents.some(entry => entry.id === host.id)">{{ language.startsWith('pt') ? 'Recente' : 'Recent' }}</small>
          </div>
        </aside>
        <div
          v-if="props.siteAssist"
          class="proof"
          data-testid="site-assist"
        >
          <label><input
            v-model="captureOptIn"
            type="checkbox"
          > {{ language.startsWith('pt') ? 'Também oferecer salvar o login deste formulário' : 'Also offer to save the login from this form' }}</label>
          <button
            type="button"
            class="link"
            :disabled="assistBusy"
            @click="enableSiteAssist"
          >
            {{ language.startsWith('pt') ? 'Ativar sugestões neste site' : 'Enable suggestions on this site' }}
          </button>
        </div>
        <section
          v-if="pendingSiteFill"
          class="proof"
          data-testid="site-fill-resume"
        >
          <p>{{ language.startsWith('pt') ? 'Login selecionado para' : 'Login selected for' }} {{ pendingSiteFill.origin }}</p>
          <p v-if="fillReady">
            {{ language.startsWith('pt') ? 'Identidade confirmada. Confira o site e confirme o preenchimento.' : 'Identity confirmed. Review the site and confirm filling.' }}
          </p>
          <button
            v-if="fillReady"
            type="button"
            class="primary"
            :disabled="siteBusy"
            @click="confirmSiteFill"
          >
            {{ language.startsWith('pt') ? 'Confirmar preenchimento' : 'Confirm filling' }}
          </button>
          <button
            v-else
            type="button"
            class="link"
            @click="checkSiteFill"
          >
            {{ language.startsWith('pt') ? 'Verificar confirmação' : 'Check confirmation' }}
          </button>
          <button
            type="button"
            class="link"
            @click="cancelSiteFill"
          >
            {{ language.startsWith('pt') ? 'Cancelar' : 'Cancel' }}
          </button>
        </section>
        <div
          v-if="editorProofState !== 'idle'"
          class="proof"
          role="status"
        >
          <p>{{ editorProofState === 'ready' ? (language.startsWith('pt') ? 'Identidade confirmada. Revise o formulário e selecione Salvar.' : 'Identity confirmed. Review the form and select Save.') : (language.startsWith('pt') ? 'Aguardando confirmação no portal. O formulário foi preservado.' : 'Waiting for portal confirmation. Your form was preserved.') }}</p>
          <button
            v-if="editorProofState === 'waiting'"
            type="button"
            class="link"
            @click="checkEditorProof"
          >
            {{ language.startsWith('pt') ? 'Verificar confirmação' : 'Check confirmation' }}
          </button>
        </div>
        <SitePanel
          :key="preferenceScope"
          :client="props.client.sites"
          :preferences="sitePreferences"
          :captured-draft="capturedDraft"
          :current-origin="siteOrigin"
          :locale="language"
          :write-access="writeAccess"
          :host-options="siteHosts"
          :fill-enabled="fillEnabled"
          :fill-busy="siteBusy"
          @consumed="consumedDraft"
          @proof-required="stageEditorProof"
          @fill="fillLogin"
          @connect="openHost"
          @open="openWebsite"
          @search-hosts="searchSiteHosts"
        />
        <p
          v-if="siteBusy"
          role="status"
        >
          {{ language.startsWith('pt') ? 'Preenchendo…' : 'Filling…' }}
        </p>
        <p
          v-if="siteMessage"
          role="status"
        >
          {{ siteMessage }}
        </p>
        <button
          v-if="siteNeedsProof"
          type="button"
          class="primary"
          @click="siteProof"
        >
          {{ language.startsWith('pt') ? 'Confirmar identidade no portal' : 'Confirm identity in the portal' }}
        </button>
      </template>
      <template v-else>
        <div
          v-if="features.create"
          class="actions"
        >
          <button
            type="button"
            class="link"
            data-testid="vaultnaccess-create"
            @click="edit('create-secret')"
          >
            {{ editLabels.create }}
          </button>
          <button
            type="button"
            class="link"
            data-testid="vaultnaccess-import"
            @click="edit('import-pem')"
          >
            {{ editLabels.pem }}
          </button>
        </div>
        <p
          v-if="saved"
          role="status"
        >
          {{ editLabels.saved }}
        </p>
        <form
          class="search"
          role="search"
          @submit.prevent="search()"
        >
          <PopupIcon name="search" />
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            :aria-label="t.search"
            :placeholder="t.searchHint"
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
              v-for="(item, index) in items"
              :key="`${item.kind}:${item.sourceId}`"
              class="row"
            >
              <button
                :ref="(el) => { if (el) itemButtons[index] = el as HTMLButtonElement }"
                type="button"
                class="item"
                :class="{ active: index === active }"
                :title="t.open"
                @focus="active = index"
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
              <button
                type="button"
                class="link host-toggle"
                :aria-expanded="related?.key === keyOf(item)"
                :data-testid="`vaultnaccess-hosts-${item.kind}-${item.sourceId}`"
                @click="toggleHosts(item)"
              >
                {{ hostWords.title }}
              </button>
              <div
                v-if="related?.key === keyOf(item)"
                class="proof host-list"
                data-testid="vaultnaccess-host-list"
                :aria-busy="related.loading"
              >
                <p
                  v-if="related.loading"
                  role="status"
                >
                  {{ hostWords.loading }}
                </p>
                <p
                  v-if="related.error"
                  role="alert"
                >
                  {{ related.error }}
                </p>
                <p v-if="!related.loading && !related.error && !related.hosts.length">
                  {{ hostWords.empty }}
                </p>
                <ul v-if="related.hosts.length">
                  <li
                    v-for="host in orderedHosts(related.hosts)"
                    :key="host.id"
                  >
                    <button
                      type="button"
                      class="link"
                      @click="openHost(host.id)"
                    >
                      {{ language.toLowerCase().startsWith('pt') ? 'Conectar pelo NodeAccess' : 'Connect with NodeAccess' }} · {{ host.name }}
                    </button>
                    <button
                      v-if="hostPreferences"
                      type="button"
                      class="link"
                      :aria-label="`${language.startsWith('pt') ? 'Favorito' : 'Favorite'}: ${host.name}`"
                      :aria-pressed="hostPreferenceState.favorites.includes(host.id)"
                      @click="favoriteHost(host.id)"
                    >
                      {{ hostPreferenceState.favorites.includes(host.id) ? '★' : '☆' }}
                    </button>
                    <small v-if="hostPreferenceState.recents.some(entry => entry.id === host.id)">{{ language.startsWith('pt') ? 'Recente' : 'Recent' }}</small>
                  </li>
                </ul>
                <button
                  v-if="related.error || related.cursor"
                  type="button"
                  class="link"
                  :disabled="related.loading"
                  @click="loadHosts(item, !!related.cursor)"
                >
                  {{ related.error ? hostWords.retry : hostWords.more }}
                </button>
              </div>
              <span
                v-if="features.create && item.kind === 'secret' && (item.writable ?? item.scope === 'personal')"
                class="actions"
              >
                <button
                  type="button"
                  class="link"
                  :aria-label="`${editLabels.edit}: ${item.label}`"
                  @click="edit('update-secret', item)"
                >{{ editLabels.edit }}</button>
                <button
                  type="button"
                  class="link"
                  :aria-label="`${editLabels.rotate}: ${item.label}`"
                  @click="edit('rotate-secret', item)"
                >{{ editLabels.rotate }}</button>
              </span>
              <span
                v-if="item.kind === 'secret' && (features.reveal || features.copy)"
                class="actions"
              >
                <button
                  v-if="features.reveal"
                  type="button"
                  class="icon-button"
                  :aria-label="`${t.reveal}: ${item.label}`"
                  :title="t.reveal"
                  :disabled="!!working"
                  :data-testid="`vaultnaccess-reveal-${item.sourceId}`"
                  @click="act(item, 'reveal')"
                ><PopupIcon name="eye" /></button>
                <button
                  v-if="features.copy"
                  type="button"
                  class="icon-button"
                  :aria-label="`${t.copy}: ${item.label}`"
                  :title="t.copy"
                  :disabled="!!working"
                  :data-testid="`vaultnaccess-copy-${item.sourceId}`"
                  @click="act(item, 'copy')"
                ><PopupIcon name="copy" /></button>
              </span>
              <form
                v-if="pending && keyOf(pending.item) === keyOf(item)"
                class="proof"
                autocomplete="off"
                data-testid="vaultnaccess-proof"
                @submit.prevent="confirmProof"
              >
                <button
                  type="button"
                  class="primary small portal-proof"
                  :disabled="!!working || portal === 'waiting'"
                  data-testid="vaultnaccess-proof-portal"
                  @click="confirmInPortal"
                >
                  {{ t.portalProof }}
                </button>
                <span class="proof-or">{{ t.proofOr }}</span>
                <label
                  :for="`vaultnaccess-proof-${item.sourceId}`"
                  class="code-label"
                >{{ pending.action === 'reveal' ? t.proofReveal : t.proofCopy }}</label>
                <span class="proof-row">
                  <input
                    :id="`vaultnaccess-proof-${item.sourceId}`"
                    v-model="proofOtp"
                    class="code-input small"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="6"
                    data-testid="vaultnaccess-proof-otp"
                  >
                  <button
                    type="submit"
                    class="primary small"
                    :disabled="!!working || !/^[0-9]{6}$/.test(proofOtp)"
                    data-testid="vaultnaccess-proof-submit"
                  >{{ t.proofSubmit }}</button>
                  <button
                    type="button"
                    class="link"
                    @click="cancelProof"
                  >{{ t.cancel }}</button>
                </span>
              </form>
              <div
                v-if="revealed && revealed.key === keyOf(item)"
                class="secret-value"
                data-testid="vaultnaccess-revealed"
              >
                <code>{{ revealed.value }}</code>
                <button
                  type="button"
                  class="link"
                  @click="forget"
                >
                  {{ t.hide }}
                </button>
              </div>
              <div
                v-if="copyReady && copyReady.key === keyOf(item)"
                class="secret-value"
              >
                <button
                  type="button"
                  class="primary small"
                  data-testid="vaultnaccess-copy-confirm"
                  @click="confirmCopy"
                >
                  {{ t.copyConfirm }}
                </button>
              </div>
              <p
                v-if="copiedKey === keyOf(item)"
                class="copied"
                role="status"
              >
                {{ t.copied }}
              </p>
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
      </template>
    </section>

    <footer class="foot">
      <span
        v-if="phase === 'connected' && fingerprint"
        class="note"
        :title="t.deviceTitle"
        data-testid="vaultnaccess-device"
      >
        <PopupIcon name="lock" />{{ t.device }} <code class="device">{{ fingerprint }}</code>
      </span>
      <span
        v-else
        class="note"
      >
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
.code-form { display: flex; flex-direction: column; gap: 8px; width: 100%; text-align: left; }
.code-links { display: flex; gap: 16px; justify-content: center; }
.code-label { color: var(--muted); font-size: 12px; }
.code-input { padding: 9px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); text-align: center; font: 600 18px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .3em; }
.code-input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 2px var(--focus); }
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
.row { display: flex; flex-wrap: wrap; align-items: center; }
.row > .item { flex: 1; min-width: 0; width: auto; }
.actions { display: flex; gap: 2px; }
[data-site-sections] { display: flex; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
[data-site-sections] .link { padding: 6px 10px; border-radius: 6px; }
[data-site-sections] [aria-pressed="true"] { background: var(--primary-soft); }
.icon-button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none; color: var(--muted); }
.icon-button:hover:not(:disabled) { background: var(--surface); color: var(--primary); }
.proof, .secret-value, .copied { flex-basis: 100%; margin: 4px 0 6px 48px; }
.proof { display: flex; flex-direction: column; gap: 6px; }
.host-toggle { order: 1; flex-basis: 100%; margin-left: 48px; text-align: left; }
.host-list { order: 2; min-width: 0; }
.host-list ul { margin: 0; padding-left: 16px; max-height: 160px; overflow: auto; }
.host-list .link { max-width: 100%; overflow-wrap: anywhere; text-align: left; }
.proof-row { display: flex; align-items: center; gap: 8px; }
.code-input.small { width: 110px; padding: 6px 8px; font-size: 14px; }
.primary.small { width: auto; padding: 6px 12px; font-size: 12px; }
.secret-value { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; background: var(--surface); }
.secret-value code { flex: 1; overflow-wrap: anywhere; font: 600 13px/1.4 ui-monospace, Menlo, Consolas, monospace; }
.copied { color: var(--primary); font-size: 12px; }
.item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 6px; background: none; text-align: left; }
.item:hover, .item:focus-visible, .item.active { background: var(--surface); }
.kind { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 6px; }
.kind.secret { background: var(--secret-soft); color: var(--secret); }
.kind.pem { background: var(--pem-soft); color: var(--pem); }
.body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.label { font-weight: 600; overflow-wrap: anywhere; }
.description { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; gap: 4px; }
.tag { padding: 0 6px; border-radius: 4px; background: var(--surface-2); color: var(--muted); font-size: 11px; }
.go { color: var(--muted); opacity: 0; transition: opacity .12s; }
.item:hover .go, .item:focus-visible .go, .item.active .go { opacity: 1; }
.more { width: 100%; margin-top: 6px; padding: 6px; border: 1px solid var(--border); border-radius: 6px; background: none; color: var(--primary); }
.empty { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 0; padding: 18px 0; color: var(--muted); }
.empty .icon { width: 22px; height: 22px; opacity: .6; }

.skeleton { display: flex; flex-direction: column; gap: 8px; padding: 14px; }
.connected .skeleton { padding: 0; }
.skeleton span { height: 36px; border-radius: 6px; background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.2s ease-in-out infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton span { animation: none; } }

.portal-proof { width: 100%; margin-bottom: 4px; }
.proof-or { display: block; margin-bottom: 4px; color: var(--muted); font-size: 11px; }
.foot .device { font: 600 11px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; color: var(--text); }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding: 10px 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; }
.note { display: inline-flex; align-items: center; gap: 6px; }
.note .icon { width: 12px; height: 12px; }
.link { padding: 2px 0; border: 0; background: none; color: var(--primary); font-size: 12px; font-weight: 600; }
.link:hover { text-decoration: underline; }
</style>
