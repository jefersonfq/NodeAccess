<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, getLocale, type Locale } from '@/plugins/i18n'

const { locale } = useI18n()
const current = ref<Locale>(getLocale())

watch(locale, (v) => { current.value = v as Locale })

function toggle(l: Locale) {
  setLocale(l)
  current.value = l
}
</script>

<template>
  <div class="locale-switcher">
    <button
      v-for="l in (['pt-BR', 'en'] as Locale[])"
      :key="l"
      class="locale-switcher__option"
      :class="{ 'is-active': current === l }"
      @click="toggle(l)"
    >
      {{ l === 'pt-BR' ? 'PT' : 'EN' }}
    </button>
  </div>
</template>

<style scoped>
.locale-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border: 1px solid var(--na-border);
  border-radius: 6px;
  background: var(--na-sidebar-search-bg);
}

.locale-switcher__option {
  border: 0;
  border-radius: 4px;
  padding: 2px 8px;
  background: transparent;
  color: var(--na-text-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.locale-switcher__option:hover {
  background: var(--na-sidebar-hover);
  color: var(--na-text-strong);
}

.locale-switcher__option.is-active {
  background: var(--na-primary-soft);
  color: #4f46e5;
}

:global(body[data-theme='dark']) .locale-switcher__option.is-active {
  color: #818cf8;
}
</style>
