import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createI18n } from 'vue-i18n'
import type { PublicSecurityCatalog } from '@/security-center/types'
import ptBR from '@/locales/pt-BR.json'
import en from '@/locales/en.json'
import SecurityCenter from './SecurityCenterView.vue'

const catalog = vi.hoisted(() => ({
  revision: '1', reviewedAt: '2026-11-06',
  sections: [{ id: 'audit', title: 'Auditoria', summary: 'Registro conforme configuração.', details: ['Consulta sujeita a permissão.'], conditions: ['A gravação depende de habilitação.'] }],
  practices: ['Proteja o seu dispositivo.'],
}))
vi.mock('virtual:nodeaccess-security-center', () => ({ default: catalog }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ hash: '' }),
  RouterLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
}))
const initial: PublicSecurityCatalog = structuredClone(catalog)
let fetchSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  delete (catalog as PublicSecurityCatalog).unavailable
  Object.assign(catalog, structuredClone(initial))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Security Center must not fetch runtime data'))
})
afterEach(() => vi.restoreAllMocks())
async function render(locale = 'pt-BR'): Promise<string> {
  const app = createSSRApp(SecurityCenter)
  app.use(createI18n({ legacy: false, locale, messages: { 'pt-BR': ptBR, en } }))
  return renderToString(app)
}

describe('Security Center presentation', () => {
  it('shows conditions next to the explanation and distinguishes editorial review from active protection', async () => {
    const html = await render()
    expect(html).toContain('A gravação depende de habilitação.')
    expect(html).toContain('não é um diagnóstico das proteções ativas')
    expect(html).toContain('não uma auditoria da sua organização')
    expect(html).toContain('datetime="2026-11-06"')
    expect(html).toContain('href="#security-audit"')
    expect(html).toContain('aria-labelledby="security-title-audit"')
    expect(html).toContain('href="/profile"')
    expect(html).not.toContain('/admin/')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('escapes editorial text instead of interpreting HTML or activating its links', async () => {
    catalog.sections[0].summary = '<img src=x onerror="alert(1)">'
    catalog.sections[0].details = ['<script>alert(1)</script>']
    catalog.practices = ['<a href="javascript:alert(1)">open</a>']
    const html = await render()
    expect(html).toContain('&lt;img src=x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;a href=')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<a href="javascript:')
  })

  it('identifies Portuguese editorial content when the interface is in English', async () => {
    const html = await render('en')
    expect(html).toContain('Security Center')
    expect(html).toContain('currently available in Brazilian Portuguese')
    expect(html).toContain('lang="pt-BR"')
    expect(html).toMatch(/<h3 lang="en"[^>]*>Conditions and limits<\/h3>/)
    expect(html).toContain('Review my profile')
  })

  it('shows an unavailable catalog without review metadata or parsing an invalid date', async () => {
    Object.assign(catalog, { unavailable: true, revision: '', reviewedAt: '', sections: [], practices: [] })
    const html = await render()
    expect(html).toContain('Central de Segurança')
    expect(html).toContain('Não há conteúdo revisado disponível')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('data-security-review')
    expect(html).not.toContain('<time')
    expect(html).not.toContain('security-section')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('handles an empty reviewed catalog without inventing an active control or a retry operation', async () => {
    catalog.sections = []
    catalog.practices = []
    const html = await render()
    expect(html).toContain('Não há conteúdo revisado disponível')
    expect(html).not.toContain('href="#security-')
    expect(html).not.toContain('security-practices-title')
    expect(html).not.toContain('href="/profile"')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
