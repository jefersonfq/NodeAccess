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
  <div class="flex items-center gap-0.5 px-1 py-0.5 rounded-md" style="background: #1a1a20; border: 1px solid #2a2a34;">
    <button
      v-for="l in (['pt-BR', 'en'] as Locale[])"
      :key="l"
      class="px-2 py-0.5 rounded text-[11px] font-medium transition-colors"
      :style="current === l
        ? 'background: rgba(99,102,241,0.2); color: #818cf8;'
        : 'color: #555; background: transparent;'"
      @click="toggle(l)"
    >
      {{ l === 'pt-BR' ? 'PT' : 'EN' }}
    </button>
  </div>
</template>
