import { createI18n } from 'vue-i18n'
import ptBR from '@/locales/pt-BR.json'
import en   from '@/locales/en.json'

export type Locale = 'pt-BR' | 'en'

const STORAGE_KEY = 'nodeaccess_locale'

function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY) as Locale | null
  if (saved === 'pt-BR' || saved === 'en') return saved
  const browser = navigator.language
  if (browser.startsWith('en')) return 'en'
  return 'pt-BR'
}

export const i18n = createI18n({
  legacy:        false,
  locale:        detectLocale(),
  fallbackLocale:'pt-BR',
  messages: {
    'pt-BR': ptBR,
    en,
  },
  datetimeFormats: {
    'pt-BR': {
      short: {
        dateStyle: 'short',
        timeStyle: 'short',
      },
    },
    pt: {
      short: {
        dateStyle: 'short',
        timeStyle: 'short',
      },
    },
    en: {
      short: {
        dateStyle: 'short',
        timeStyle: 'short',
      },
    },
  },
})

export function setLocale(locale: Locale) {
  (i18n.global.locale as { value: Locale }).value = locale
  localStorage.setItem(STORAGE_KEY, locale)
  document.documentElement.lang = locale
}

export function getLocale(): Locale {
  return (i18n.global.locale as { value: Locale }).value
}
