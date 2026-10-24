import { describe, it, expect, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import pt from '../locales/pt-BR.json'
import en from '../locales/en.json'
describe('terminal AI opening messages', () => {
  it.each([['pt-BR', pt], ['en', en]] as const)('compiles opening copy in %s', (locale, messages) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const i18n = createI18n({legacy:false,locale,messages:{[locale]:messages}})
      const text = i18n.global.t('terminal.ai.modalInfo', { prefix: '@ai' })
      expect(text).toContain('Ctrl/Cmd+Shift+I')
      expect(text).toContain('@ai')
      for (const key of Object.keys(messages.terminal.ai.quick)) {
        if (key === 'rejection') {
          for (const reason of Object.keys(messages.terminal.ai.quick.rejection)) expect(i18n.global.t('terminal.ai.quick.rejection.' + reason)).not.toBe('terminal.ai.quick.rejection.' + reason)
        } else expect(i18n.global.t('terminal.ai.quick.' + key)).not.toBe('terminal.ai.quick.' + key)
      }
      expect(i18n.global.t('terminal.ai.shortcuts')).toContain('@ia')
      for (const group of ['context','failures'] as const) for (const key of Object.keys(messages.terminal.ai[group])) expect(i18n.global.t('terminal.ai.'+group+'.'+key)).not.toBe('terminal.ai.'+group+'.'+key)
      expect(errors).not.toHaveBeenCalled()
    } finally { errors.mockRestore() }
  })
})
