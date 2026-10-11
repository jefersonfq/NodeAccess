<script setup lang="ts">
import RichText from '@/components/RichText'
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NSpin, useMessage } from 'naive-ui'
import { useManualStore } from '@/stores/manual'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
import { manualPrintHtml, manualPrintAssets } from '@/manual/print'
import bundle from 'virtual:nodeaccess-manual'
const { t } = useI18n()
const message = useMessage()
const manual = useManualStore()
const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const query = ref('')
const enlarged = ref(false)
const normalize = (text:string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const filtered = computed(() => bundle.articles.filter(article => normalize(`${article.title} ${article.summary} ${article.text}`).includes(normalize(query.value.trim()))))
const selected = computed(() => bundle.articles.find(a => a.id === route.params.chapter))
const missing = computed(() => !!route.params.chapter && !selected.value)
const pageEl = ref<HTMLElement | null>(null)
function scrollToStart(): void { void nextTick((): void | undefined => pageEl.value?.scrollIntoView({block:'start'})) }
onMounted(scrollToStart)
watch(() => route.params.chapter, () => { enlarged.value = false; scrollToStart() })
function followArticleLink(event:MouseEvent): void {
  const link = (event.target as HTMLElement).closest('a')
  if(link?.getAttribute('href')?.startsWith('/manual/')) { event.preventDefault(); void router.push(link.getAttribute('href')!) }
}
async function print(): Promise<void> {
  if (!selected.value) return
  const popup = window.open('', '_blank')
  if (!popup) { message.warning(t('manual.printBlocked')); return }
  popup.opener = null
  const article = selected.value
  try {
    const assets = await manualPrintAssets(article)
    if (popup.closed) return
    popup.document.open()
    popup.document.write(manualPrintHtml(article, bundle.version, window.location.origin, assets))
    popup.document.close()
    await Promise.all(Array.from(popup.document.images).map(img => img.decode()))
    if (!popup.closed) popup.print()
  } catch {
    if (!popup.closed) popup.close()
    message.error(t('manual.printFailed'))
  }
}
</script>
<template>
  <div
    ref="pageEl"
    class="manual-page"
    :class="{ 'manual-page-light': !ui.isDark }"
    data-manual-page
  >
    <header class="manual-header">
      <RouterLink
        to="/manual"
        class="manual-wordmark"
      >
        NODEACCESS <span>/ {{ $t('manual.title') }}</span>
      </RouterLink>
      <span
        class="manual-version"
        data-manual-version
      >{{ $t('manual.version') }} {{ bundle.version }}</span>
    </header>
    <div
      v-if="manual.loading"
      class="manual-state"
      role="status"
    >
      <NSpin size="small" /> {{ $t('manual.loading') }}
    </div>
    <div
      v-else-if="!manual.enabled"
      class="manual-state"
    >
      <h1>{{ manual.failed ? $t('manual.loadError') : $t('manual.disabledTitle') }}</h1>
      <p>{{ manual.failed ? $t('manual.loadErrorHelp') : $t('manual.disabledHelp') }}</p>
      <NButton
        v-if="manual.failed"
        @click="manual.load"
      >
        {{ $t('manual.retry') }}
      </NButton>
      <RouterLink
        v-if="auth.isAdmin"
        to="/admin/settings#manual"
      >
        {{ $t('manual.settings.title') }}
      </RouterLink>
    </div>
    <div
      v-else
      class="manual-layout"
    >
      <aside
        class="manual-index"
        :aria-label="$t('manual.contents')"
      >
        <NInput
          v-model:value="query"
          clearable
          :placeholder="$t('manual.search')"
          :aria-label="$t('manual.search')"
        />
        <div class="manual-index-label">
          {{ $t('manual.contents') }}
        </div>
        <nav>
          <RouterLink
            v-for="article in filtered"
            :key="article.id"
            :to="`/manual/${article.id}`"
            :aria-current="selected?.id === article.id ? 'page' : undefined"
            :data-manual-chapter="article.id"
          >
            <span class="manual-index-number">{{ String(bundle.articles.indexOf(article)+1).padStart(2,'0') }}</span>{{ article.title }}
          </RouterLink>
        </nav>
        <p
          v-if="!filtered.length"
          class="manual-empty"
          role="status"
        >
          {{ $t('manual.noResults') }}
        </p>
        <p class="manual-index-note">
          {{ $t('manual.pilotNote') }}
        </p>
      </aside>
      <main class="manual-content">
        <template v-if="selected">
          <div class="manual-eyebrow">
            {{ $t('manual.guide') }} · {{ $t('manual.reviewed') }} {{ selected.reviewedAt }}
          </div>
          <div class="manual-title-row">
            <h1>{{ selected.title }}</h1><NButton
              size="small"
              secondary
              @click="print"
            >
              {{ $t('manual.print') }}
            </NButton>
          </div>
          <p class="manual-lead">
            {{ selected.summary }}
          </p>
          <img
            class="manual-flow"
            :src="selected.flow"
            :alt="selected.summary"
            width="780"
            height="166"
          >
          <ol
            class="manual-flow-mobile"
            :aria-label="$t('manual.guide')"
          >
            <li
              v-for="(step,index) in selected.journey"
              :key="step"
            >
              <span>{{ index+1 }}</span>{{ step }}
            </li>
          </ol>
          <figure
            v-if="selected.screenshot"
            class="manual-figure"
          >
            <button
              type="button"
              :aria-expanded="enlarged"
              :aria-label="$t('manual.zoomImage')"
              :class="{ enlarged }"
              @click="enlarged = !enlarged"
            >
              <img
                :src="selected.screenshot"
                :alt="$t('manual.screenshotAlt', {title:selected.title})"
                loading="lazy"
              >
            </button>
            <figcaption>{{ $t('manual.exampleCaption') }}</figcaption>
          </figure>
          <RichText
            tag="article"
            class="manual-prose"
            :html="selected.html"
            @click="followArticleLink"
          />
          <footer class="manual-article-footer">
            {{ $t('manual.version') }} {{ bundle.version }} · {{ $t('manual.build') }} {{ bundle.builtAt.slice(0,10) }} · {{ $t('manual.articleFooter') }}
          </footer>
        </template>
        <div
          v-else-if="missing"
          class="manual-state"
        >
          <h1>{{ $t('manual.notFound') }}</h1><RouterLink to="/manual">
            {{ $t('manual.backToContents') }}
          </RouterLink>
        </div>
        <template v-else>
          <div class="manual-eyebrow">
            {{ $t('manual.welcomeEyebrow') }}
          </div>
          <h1>{{ $t('manual.welcomeTitle') }}</h1>
          <p class="manual-lead">
            {{ $t('manual.welcomeDescription') }}
          </p>
          <div class="manual-cards">
            <RouterLink
              v-for="(article,index) in filtered"
              :key="article.id"
              :to="`/manual/${article.id}`"
              class="manual-card"
            >
              <span class="manual-card-number">{{ String(index+1).padStart(2,'0') }} <span aria-hidden="true">↗</span></span>
              <h2>{{ article.title }}</h2><p>{{ article.summary }}</p><span class="manual-card-action">{{ $t('manual.readGuide') }} →</span>
            </RouterLink>
          </div>
          <p
            v-if="!filtered.length"
            role="status"
          >
            {{ $t('manual.noResults') }}
          </p>
        </template>
      </main>
    </div>
  </div>
</template>
<style scoped>
.manual-page { --manual-text:#dfe8f5; --manual-muted:#a0b1c7; --manual-line:#334155; --manual-card:#17202e; --manual-accent:#86e3ce; color:var(--manual-text); background:var(--na-bg); max-width:1440px; margin:auto; padding:24px 32px 60px; }
.manual-page.manual-page-light { --manual-text:#172b45; --manual-muted:#52657c; --manual-line:#d7e0eb; --manual-card:#fff; --manual-accent:#176650; }
.manual-header { display:flex; align-items:center; justify-content:space-between; gap:15px; padding-bottom:24px; border-bottom:1px solid var(--manual-line); }
.manual-wordmark { font-size:12px; font-weight:800; letter-spacing:2px; color:var(--manual-text); }
.manual-wordmark span { font-weight:400; letter-spacing:0; color:var(--manual-muted); margin-left:8px; }
.manual-version { border:1px solid var(--manual-line); border-radius:20px; padding:5px 12px; font-size:11px; white-space:nowrap; }
.manual-layout { display:grid; grid-template-columns:240px minmax(0,1fr); gap:48px; padding-top:30px; }
.manual-index { min-width:0; }
.manual-index-label { font-size:10px; text-transform:uppercase; letter-spacing:2px; color:var(--manual-muted); margin:25px 0 12px; }
.manual-index nav { display:flex; flex-direction:column; gap:5px; }
.manual-index nav a { display:flex; gap:10px; padding:11px 10px; border-radius:8px; font-size:13px; line-height:1.5; color:var(--manual-muted); }
.manual-index nav a:hover,.manual-index nav a[aria-current] { background:var(--manual-card); color:var(--manual-accent); }
.manual-index-number { font-size:10px; padding-top:3px; font-variant-numeric:tabular-nums; }
.manual-index-note,.manual-empty { font-size:12px; line-height:1.7; color:var(--manual-muted); margin-top:24px; }
.manual-content { min-width:0; max-width:900px; }
.manual-eyebrow { color:var(--manual-accent); font-size:10px; letter-spacing:1.4px; text-transform:uppercase; margin-bottom:15px; }
h1 { font-size:clamp(27px,3vw,42px); line-height:1.15; font-weight:650; letter-spacing:-1px; max-width:750px; margin:0; }
.manual-lead { font-size:16px; line-height:1.7; color:var(--manual-muted); margin:18px 0 28px; max-width:700px; }
.manual-title-row { display:flex; justify-content:space-between; align-items:start; gap:16px; }
.manual-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.manual-card { display:flex; flex-direction:column; padding:23px; border-radius:14px; border:1px solid var(--manual-line); background:var(--manual-card); color:var(--manual-text); transition:border-color .15s; }
.manual-card:hover { border-color:var(--manual-accent); }
.manual-card-number { display:flex; justify-content:space-between; color:var(--manual-accent); font-size:12px; }
.manual-card h2 { font-size:19px; line-height:1.4; margin:22px 0 12px; }
.manual-card p { color:var(--manual-muted); font-size:13px; line-height:1.7; flex:1; }
.manual-card-action { color:var(--manual-accent); margin-top:24px; font-size:12px; }
.manual-flow-mobile { display:none; }
.manual-flow { width:100%; height:auto; border-radius:14px; margin-bottom:24px; }
.manual-figure { margin:0 0 26px; }
.manual-figure button { width:100%; border:1px solid var(--manual-line); border-radius:12px; overflow:hidden; cursor:zoom-in; max-height:340px; }
.manual-figure button.enlarged { max-height:none; cursor:zoom-out; }
.manual-figure img { display:block; width:100%; }
.manual-figure figcaption { color:var(--manual-muted); font-size:11px; margin-top:8px; }
.manual-prose { font-size:14px; line-height:1.85; }
.manual-prose :deep(h2) { font-size:23px; font-weight:600; letter-spacing:-.3px; margin:36px 0 14px; padding-top:20px; border-top:1px solid var(--manual-line); }
.manual-prose :deep(p) { margin:12px 0; }
.manual-prose :deep(ul),.manual-prose :deep(ol) { padding-left:22px; margin:14px 0; }
.manual-prose :deep(ul) { list-style:disc; }.manual-prose :deep(ol) { list-style:decimal; }
.manual-prose :deep(li) { padding-left:5px; margin:10px 0; }
.manual-prose :deep(strong) { font-weight:650; }.manual-prose :deep(a) { color:var(--manual-accent); text-decoration:underline; }
.manual-prose :deep(table) { width:100%; border-collapse:collapse; font-size:13px; }.manual-prose :deep(td),.manual-prose :deep(th) { padding:12px; border:1px solid var(--manual-line); text-align:left; }
.manual-article-footer { margin-top:35px; padding-top:20px; border-top:1px solid var(--manual-line); font-size:11px; color:var(--manual-muted); }
.manual-state { display:flex; align-items:flex-start; flex-direction:column; gap:20px; padding:50px 0; }.manual-state h1 { font-size:26px; }.manual-state a { text-decoration:underline; }
a:focus-visible,button:focus-visible { outline:2px solid var(--manual-accent); outline-offset:4px; }
@media(max-width:1000px) { .manual-page{padding:20px}.manual-layout{grid-template-columns:190px minmax(0,1fr);gap:25px}.manual-cards{grid-template-columns:1fr} }
@media(max-width:680px) { .manual-flow{display:none}.manual-flow-mobile{display:flex;flex-direction:column;gap:12px;padding:18px;background:var(--manual-card);border:1px solid var(--manual-line);border-radius:12px;margin:0 0 24px}.manual-flow-mobile li{display:flex;align-items:center;gap:12px;font-size:14px}.manual-flow-mobile li span{color:var(--manual-accent);font-variant-numeric:tabular-nums} .manual-layout{grid-template-columns:1fr;gap:25px}.manual-index nav{display:grid;grid-template-columns:1fr 1fr}.manual-index-note{display:none}.manual-header{align-items:flex-start}.manual-wordmark span{display:block;margin-left:0;margin-top:4px}.manual-title-row{flex-direction:column}.manual-prose :deep(table){font-size:11px}.manual-prose :deep(td),.manual-prose :deep(th){padding:6px} }
@media(prefers-reduced-motion:reduce) { .manual-card{transition:none} }

</style>
