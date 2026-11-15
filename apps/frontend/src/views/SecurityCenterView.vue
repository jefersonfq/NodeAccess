<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import catalog from 'virtual:nodeaccess-security-center'

const { t, locale } = useI18n()
const route = useRoute()
const pageEl = ref<HTMLElement | null>(null)
function scrollToSection(): void {
  void nextTick(() => {
    const target = Array.from(pageEl.value?.querySelectorAll<HTMLElement>('.security-section') ?? [])
      .find(section => `#${section.id}` === route.hash) ?? pageEl.value
    target?.scrollIntoView({ block: 'start' })
  })
}
onMounted(scrollToSection)
watch(() => route.hash, scrollToSection, { flush: 'post' })
const reviewedDate = computed(() => new Intl.DateTimeFormat(locale.value, {
  dateStyle: 'long', timeZone: 'UTC',
}).format(new Date(`${catalog.reviewedAt}T12:00:00Z`)))
</script>

<template>
  <div
    ref="pageEl"
    class="security-center"
    data-security-center
  >
    <header class="page-header security-header">
      <h1>{{ t('securityCenter.title') }}</h1>
      <p>{{ t('securityCenter.introduction') }}</p>
      <p
        class="security-scope"
        data-security-scope
      >
        {{ t('securityCenter.scope') }}
      </p>
      <p
        v-if="!locale.startsWith('pt')"
        class="security-language-note"
      >
        {{ t('securityCenter.languageNote') }}
      </p>
    </header>

    <div class="security-layout">
      <nav
        v-if="catalog.sections.length || catalog.practices.length"
        class="security-index"
        :aria-label="t('securityCenter.contents')"
      >
        <span class="security-index-title">{{ t('securityCenter.contents') }}</span>
        <a
          v-for="(section, index) in catalog.sections"
          :key="section.id"
          :href="`#security-${section.id}`"
          lang="pt-BR"
        >
          <span
            class="security-index-number"
            aria-hidden="true"
          >{{ String(index + 1).padStart(2, '0') }}</span>
          <span>{{ section.title }}</span>
        </a>
        <a
          v-if="catalog.practices.length"
          href="#security-practices"
        >{{ t('securityCenter.practices') }}</a>
      </nav>

      <div class="security-content">
        <p v-if="!catalog.sections.length">
          {{ t('securityCenter.empty') }}
        </p>
        <section
          v-for="section in catalog.sections"
          :id="`security-${section.id}`"
          :key="section.id"
          class="security-section"
          :aria-labelledby="`security-title-${section.id}`"
          lang="pt-BR"
        >
          <h2 :id="`security-title-${section.id}`">
            {{ section.title }}
          </h2>
          <p class="security-summary">
            {{ section.summary }}
          </p>
          <p
            v-for="detail in section.details"
            :key="detail"
          >
            {{ detail }}
          </p>
          <div
            v-if="section.conditions.length"
            class="security-conditions"
          >
            <h3 :lang="locale">
              {{ t('securityCenter.conditions') }}
            </h3>
            <ul>
              <li
                v-for="condition in section.conditions"
                :key="condition"
              >
                {{ condition }}
              </li>
            </ul>
          </div>
        </section>

        <section
          v-if="catalog.practices.length"
          id="security-practices"
          class="security-section"
          aria-labelledby="security-practices-title"
        >
          <h2 id="security-practices-title">
            {{ t('securityCenter.practices') }}
          </h2>
          <ul lang="pt-BR">
            <li
              v-for="practice in catalog.practices"
              :key="practice"
            >
              {{ practice }}
            </li>
          </ul>
          <RouterLink
            class="security-profile-link"
            to="/profile"
          >
            {{ t('securityCenter.profileAction') }}
          </RouterLink>
        </section>

        <footer
          class="security-review"
          data-security-review
        >
          <p>
            {{ t('securityCenter.reviewedAt') }}
            <time :datetime="catalog.reviewedAt">{{ reviewedDate }}</time>
            <span aria-hidden="true"> · </span>
            {{ t('securityCenter.revision', { revision: catalog.revision }) }}
          </p>
          <p>{{ t('securityCenter.reviewScope') }}</p>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.security-center { box-sizing: border-box; width: 100%; max-width: 1200px; margin: 0 auto; padding: 32px; color: var(--na-text); }
.security-header { margin-bottom: 28px; }
.security-header h1 { margin: 0; color: var(--na-text-strong); font-size: 26px; font-weight: 650; line-height: 1.3; letter-spacing: -.4px; }
.security-header p { margin: 10px 0 0; max-width: 82ch; line-height: 1.65; }
.security-header .security-scope { margin-top: 20px; max-width: none; padding: 14px 18px; border: 1px solid var(--na-border); border-radius: 10px; background: var(--na-surface); font-size: 13px; }
.security-language-note { font-size: 13px; color: var(--na-text-muted); }
.security-layout { display: grid; grid-template-columns: 208px minmax(0, 1fr); gap: 28px; align-items: start; }
.security-index { display: flex; flex-direction: column; gap: 4px; position: sticky; top: 24px; padding: 4px 0; }
.security-index-title { margin: 0 12px 10px; font-size: 12px; font-weight: 600; color: var(--na-text-muted); }
.security-index a { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px; border-radius: 8px; color: var(--na-text); text-decoration: none; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.security-index-number { flex: 0 0 auto; color: var(--na-text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.security-index a:hover { background: var(--na-primary-soft); color: var(--na-info-text); }
.security-center a:focus-visible { outline: 2px solid var(--na-info-text); outline-offset: 3px; }
.security-content { min-width: 0; }
.security-section { padding: 24px; margin-bottom: 16px; border: 1px solid var(--na-border); border-radius: 12px; background: var(--na-surface); scroll-margin-top: 20px; overflow-wrap: anywhere; }
.security-section h2 { margin: 0 0 10px; color: var(--na-text-strong); font-size: 17px; line-height: 1.45; font-weight: 600; }
.security-section h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600; }
.security-section p { margin: 0 0 12px; line-height: 1.7; font-size: 14px; }
.security-section ul { padding-left: 20px; margin: 0; }
.security-section li { margin: 0 0 8px; line-height: 1.65; }
.security-section li:last-child { margin-bottom: 0; }
.security-conditions { margin-top: 18px; padding: 14px 16px; border-radius: 8px; background: var(--na-bg); }
.security-conditions ul { font-size: 13px; }
.security-profile-link { display: inline-block; margin-top: 16px; padding: 9px 14px; border-radius: 8px; background: var(--na-primary-soft); color: var(--na-info-text); font-size: 13px; font-weight: 600; text-decoration: none; }
.security-profile-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.security-review { padding: 6px 2px 16px; color: var(--na-text-muted); font-size: 12px; line-height: 1.6; }
.security-review p { margin: 0 0 6px; }
@media (max-width: 760px) {
  .security-center { padding: 24px 16px; }
  .security-layout { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .security-index { position: static; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; padding: 0 0 16px; border-bottom: 1px solid var(--na-border); }
  .security-index-title { grid-column: 1 / -1; margin: 0 0 6px; }
  .security-index a { padding: 8px 0; font-size: 12px; gap: 6px; }
  .security-index-number { display: none; }
  .security-section { padding: 18px; }
  .security-header { margin-bottom: 22px; }
  .security-header h1 { font-size: 22px; }
  .security-header .security-scope { padding: 12px 14px; }
  .security-conditions { padding: 12px; }
}
@media (max-width: 360px) {
  .security-index { grid-template-columns: minmax(0, 1fr); }
  .security-section { padding: 14px; }
}
</style>
