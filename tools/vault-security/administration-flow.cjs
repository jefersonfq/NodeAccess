/**
 * NA-0188 — browser flow of the vault administration across four people (two managers, an admin who is not a
 * manager, an operator), each in an isolated browser context: promote a manager through the Users tab, grant a
 * permission to a manager once a third manager exists, change the proposal validity, remove a manager. Checks
 * the explanations and disabled states, the pending notices, layout (desktop/mobile, no horizontal scroll, no
 * duplicated notices), basic accessibility (labels, names, aria-describedby) and that the page logs no errors.
 */
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')

function check(condition, message) { if (!condition) throw new Error(message) }
const now = '2026-11-23T12:00:00Z'

async function runVaultAdministrationFlow(browser, base, fixture, output) {
  const scenarios = [], contexts = new Set(), screenshots = []
  const people = [...fixture.users.values()].map(u => ({ id: u.id, tenantId: 7, name: u.name, email: u.email, role: u.role, isPlatformAdmin: false,
    canManageHosts: true, canViewLiveSessions: false, avatarUrl: null, avatarVersion: null, mfaEnabled: true, active: true, groupIds: [], deletedAt: null,
    createdAt: now, updatedAt: now }))
  /** One person in their own browser context, with the portal API mocked except the real vault routes. */
  async function as(id, { mobile = false } = {}) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'pt-BR', viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 } })
    contexts.add(context)
    const { access, refresh } = fixture.tokens(id)
    await context.addInitScript(({ access, refresh }) => {
      localStorage.setItem('na_access_token', access); localStorage.setItem('na_refresh_token', refresh)
    }, { access, refresh })
    await context.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/api/v1/vault-security/')) return route.continue()
      let body = {}
      if (path.endsWith('/features')) body = { secretsLicensed: true, secrets: true }
      else if (path === '/api/v1/users') body = { data: people, total: people.length }
      else if (path === '/api/v1/users/online') body = { data: [] }
      else if (path === '/api/v1/secrets' || path === '/api/v1/pem-keys' || path.endsWith('/groups')) body = []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    const page = await context.newPage(), errors = []
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    // Any refused vault call is a failure here, except the browser-extension panel (its routes are outside this fixture).
    page.on('response', response => {
      const path = new URL(response.url()).pathname
      if (path.startsWith('/api/v1/vault-security/') && !path.startsWith('/api/v1/vault-security/extension/') && response.status() >= 400) errors.push(`vault ${response.status()} ${path}`)
    })
    return { page, errors, close: async () => { await context.close(); contexts.delete(context) } }
  }
  const person = id => fixture.users.get(id)
  async function users(page) {
    await page.goto(`${base}/admin/users`, { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: 'davi@example.test' }).waitFor()
  }
  async function vault(page) {
    await page.goto(`${base}/vault`, { waitUntil: 'networkidle' })
    await page.getByTestId('vault-delivery-panel').waitFor()
  }
  const row = (page, email) => page.locator('tr', { hasText: email })
  async function rowAction(page, email, label) {
    await row(page, email).getByRole('button', { name: 'Ações', exact: true }).click()
    const option = page.locator('.n-dropdown-option', { hasText: label })
    await option.first().waitFor()
    return option.first()
  }
  const disabled = async option => (await option.locator('.n-dropdown-option-body').getAttribute('class')).includes('--disabled')
  async function unlock(page, id) {
    await page.locator('#vault-administration-password').fill(person(id).password)
    await page.locator('#vault-administration-otp').fill(fixture.totp(id))
    await page.getByTestId('vault-administration-confirm').click()
    await page.getByTestId('vault-administration-lock').waitFor()
  }
  async function openAdministration(page, id) {
    await page.getByTestId('vault-administration-open').click()
    await unlock(page, id)
  }
  const proposal = (page, text) => page.locator('[data-testid^="vault-administration-proposal-"]', { hasText: text })
  async function approve(page, text) {
    await proposal(page, text).getByRole('button', { name: 'Aprovar', exact: true }).click()
    await page.getByTestId('vault-administration-notice').filter({ hasText: 'Alteração aplicada' }).waitFor()
  }
  async function proposed(page) {
    await page.getByTestId('vault-administration-notice').filter({ hasText: 'Proposta criada' }).waitFor()
  }
  /** Layout and accessibility checks for the current screen, plus a private screenshot. */
  async function review(page, errors, name) {
    const report = await page.evaluate(() => {
      const visible = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden' }
      const alerts = [...document.querySelectorAll('.n-alert')].filter(visible).map(a => a.textContent.trim())
      // Library-internal +/- controls of number inputs are out of the tab order (tabindex -1); the input itself is labelled.
      const unnamed = [...document.querySelectorAll('button:not([tabindex="-1"])')].filter(visible).filter(b => !(b.textContent.trim() || b.getAttribute('aria-label') || b.getAttribute('title')))
      const described = [...document.querySelectorAll('[aria-describedby]')].filter(visible).map(e => e.getAttribute('aria-describedby'))
      const dangling = described.filter(id => !id.split(' ').every(part => document.getElementById(part)))
      const inputs = [...document.querySelectorAll('[data-testid="vault-administration"] input')].filter(visible)
      const unlabeled = inputs.filter(i => !(i.labels?.length || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.getAttribute('placeholder')))
      // A squeezed name column wraps one letter per line on small screens.
      const squeezed = [...document.querySelectorAll('[data-testid="vault-administration"] td:first-child')].filter(visible).filter(td => td.getBoundingClientRect().width < 120).length
      return { squeezed, overflow: document.documentElement.scrollWidth - innerWidth, alerts, unnamed: unnamed.length, unnamedSample: unnamed.map(b => b.outerHTML.slice(0, 160)), dangling, unlabeled: unlabeled.length }
    })
    check(report.overflow <= 2, `${name}: horizontal scroll (${report.overflow}px)`)
    check(report.squeezed === 0, `${name}: ${report.squeezed} squeezed name cell(s)`)
    check(new Set(report.alerts).size === report.alerts.length, `${name}: duplicated notice`)
    check(report.alerts.length <= 3, `${name}: too many simultaneous notices (${report.alerts.length})`)
    check(report.unnamed === 0, `${name}: ${report.unnamed} visible button(s) without an accessible name: ${report.unnamedSample.join(' | ')}`)
    check(report.dangling.length === 0, `${name}: aria-describedby points to a missing element`)
    check(report.unlabeled === 0, `${name}: vault administration input without a label`)
    check(errors.length === 0, `${name}: page error ${errors[0]}`)
    const file = join(output, `${name}.png`)
    await page.screenshot({ path: file, fullPage: true }); screenshots.push(file)
    return report
  }
  async function scenario(name, run) {
    writeFileSync(join(output, 'flow-progress.json'), JSON.stringify({ running: name, passed: scenarios }), { mode: 0o600 })
    fixture.resetLimits()
    try { await run(); scenarios.push(name) } catch (error) {
      // Private evidence of the failing screen(s), for diagnosis.
      let index = 0
      for (const context of contexts) for (const page of context.pages()) await page.screenshot({ path: join(output, `failure-${++index}.png`), fullPage: true }).catch(() => {})
      throw new Error(`${name}: ${error.message}`)
    }
  }
  try {
    await scenario('Admin who is not a manager: explained, action disabled with the reason, no counts or manager tags', async () => {
      const carla = await as(43)
      await users(carla.page)
      const option = await rowAction(carla.page, 'davi@example.test', 'Permissões do cofre (só gestores do cofre)')
      check(await disabled(option), 'Vault action is not disabled for a non-manager')
      await carla.page.keyboard.press('Escape')
      check(await carla.page.getByTestId('users-vault-pending').count() === 0, 'Non-manager sees a pending count')
      check(await carla.page.locator('[data-testid^="user-vault-manager-"]').count() === 0, 'Non-manager sees the manager list')
      await review(carla.page, carla.errors, '01-users-admin-not-manager')
      await vault(carla.page)
      await carla.page.getByTestId('vault-administration-not-manager').waitFor()
      check(await carla.page.getByTestId('vault-administration').count() === 0, 'Administration shown to a non-manager')
      await review(carla.page, carla.errors, '02-vault-admin-not-manager')
      await carla.close()
      const davi = await as(44)
      await vault(davi.page)
      check(await davi.page.getByTestId('vault-administration-not-manager').count() === 0, 'An operator got the admin explanation')
      check(davi.errors.length === 0, 'Operator vault page error'); await davi.close()
    })
    await scenario('Two managers: changes for the other manager are disabled with the reason; managers are tagged', async () => {
      const ana = await as(41)
      await users(ana.page)
      for (const id of [41, 42]) await ana.page.getByTestId(`user-vault-manager-${id}`).waitFor()
      check(await ana.page.getByTestId('user-vault-manager-43').count() === 0, 'Carla tagged as manager too early')
      await vault(ana.page); await openAdministration(ana.page, 41)
      const reveal = ana.page.getByTestId('vault-administration-propose-42-reveal')
      check(await reveal.isDisabled(), 'Grant for the only other manager is enabled')
      check(await ana.page.getByTestId('vault-administration-manager-42').isDisabled(), 'Removing the only other manager is enabled')
      check(await reveal.getAttribute('aria-describedby') === 'vault-administration-blocked', 'Disabled action does not point to its reason')
      await ana.page.getByTestId('vault-administration-blocked').waitFor()
      check(!(await ana.page.getByTestId('vault-administration-propose-44-reveal').isDisabled()), 'Grant for an operator is disabled')
      check(await ana.page.getByTestId('vault-administration-manager-41').count() === 0, 'Manager toggle offered for oneself')
      await review(ana.page, ana.errors, '03-vault-two-managers-blocked')
      await ana.close()
    })
    await scenario('Ana proposes Carla as manager; Bruno sees the pending notice in the Users tab and approves; Carla gains access', async () => {
      const ana = await as(41)
      await vault(ana.page); await openAdministration(ana.page, 41)
      await ana.page.getByTestId('vault-administration-manager-43').click(); await proposed(ana.page)
      check((await ana.page.getByTestId('vault-administration-notice').textContent()).includes('em até 2 min'), 'Proposal notice does not state the validity')
      await proposal(ana.page, 'Tornar Carla Admin <carla@example.test> gestor do cofre').getByText('Sua proposta: aguardando outro gestor aprovar.').waitFor()
      await ana.close()
      const bruno = await as(42)
      await users(bruno.page)
      await bruno.page.getByTestId('users-vault-pending').filter({ hasText: '1 alteração do cofre aguarda sua aprovação.' }).waitFor()
      await review(bruno.page, bruno.errors, '04-users-pending-notice')
      await bruno.page.getByTestId('users-vault-review').click()
      await bruno.page.getByTestId('users-vault-modal').getByText('Alterações do cofre aguardando aprovação').waitFor()
      await unlock(bruno.page, 42)
      // The review shows only what awaits approval: no user table or tenant settings.
      for (const hidden of ['vault-administration-confirmation', 'vault-administration-window', 'vault-administration-blocked'])
        check(await bruno.page.getByTestId(hidden).count() === 0, `Review window shows ${hidden}`)
      check(await bruno.page.locator('[data-testid^="vault-administration-user-"]').count() === 0, 'Review window shows the user table')
      await review(bruno.page, bruno.errors, '05-users-review-modal')
      await approve(bruno.page, 'Tornar Carla Admin <carla@example.test> gestor do cofre')
      await bruno.page.keyboard.press('Escape')
      await bruno.page.getByTestId('users-vault-modal').waitFor({ state: 'hidden' })
      await bruno.page.getByTestId('user-vault-manager-43').waitFor()
      await bruno.page.getByTestId('users-vault-pending').waitFor({ state: 'hidden' })
      await bruno.close()
      check(fixture.state.managers.has(43), 'Carla was not added to the managers')
      const carla = await as(43)
      await users(carla.page)
      const option = await rowAction(carla.page, 'davi@example.test', 'Permissões do cofre')
      check(!(await disabled(option)), 'New manager still has the action disabled')
      await carla.close()
    })
    await scenario('With three managers, Ana grants reveal to Bruno and Carla approves from his row in the Users tab', async () => {
      const ana = await as(41)
      await vault(ana.page); await openAdministration(ana.page, 41)
      check(await ana.page.getByTestId('vault-administration-blocked').count() === 0, 'Blocked hint remains with three managers')
      await ana.page.getByTestId('vault-administration-propose-42-reveal').click(); await proposed(ana.page)
      await ana.close()
      const carla = await as(43)
      await users(carla.page)
      await (await rowAction(carla.page, 'bruno@example.test', 'Permissões do cofre')).click()
      await carla.page.getByTestId('users-vault-modal').getByText('Permissões do cofre: Bruno Gestor').waitFor()
      await unlock(carla.page, 43)
      check(await carla.page.locator('[data-testid^="vault-administration-user-"]').count() === 1, 'Focused window lists other users')
      await approve(carla.page, 'Revelar para Bruno Gestor')
      await carla.close()
      check(fixture.state.grants.get('42:reveal')?.enabled === true, 'Reveal grant not applied')
      check(fixture.state.grants.get('42:reveal')?.approvedBy === 43, 'Grant approved by the wrong manager')
    })
    await scenario('Proposal validity of 24 h: proposed by Ana, approved by Bruno from the vault page notice, new proposals last 24 h', async () => {
      const ana = await as(41)
      await vault(ana.page); await openAdministration(ana.page, 41)
      await ana.page.getByTestId('vault-administration-window').getByText('Uma proposta fica aberta por 2 min').waitFor()
      await ana.page.getByTestId('vault-administration-window-select').click()
      await ana.page.locator('.n-base-select-option', { hasText: /^24 h$/ }).click()
      await ana.page.getByTestId('vault-administration-window-propose').click(); await proposed(ana.page)
      await ana.close()
      const bruno = await as(42)
      await vault(bruno.page)
      await bruno.page.getByTestId('vault-administration-pending-count').filter({ hasText: '1 alteração do cofre aguarda sua aprovação' }).waitFor()
      await openAdministration(bruno.page, 42)
      await approve(bruno.page, 'Validade das propostas do tenant: 24 h')
      await bruno.close()
      check(fixture.state.policy.proposalSeconds === 86400, 'Proposal validity not applied')
      const ana2 = await as(41)
      await vault(ana2.page); await openAdministration(ana2.page, 41)
      await ana2.page.getByTestId('vault-administration-window').getByText('Uma proposta fica aberta por 24 h').waitFor()
      await ana2.page.getByTestId('vault-administration-propose-44-copy').click(); await proposed(ana2.page)
      check((await ana2.page.getByTestId('vault-administration-notice').textContent()).includes('em até 24 h'), 'Notice ignores the new validity')
      const text = await proposal(ana2.page, 'Copiar para Davi Operador').textContent()
      check(/vence em (24 h|23 h 59 min)/.test(text), `Countdown not in hours: ${text}`)
      await review(ana2.page, ana2.errors, '06-vault-24h-validity')
      await ana2.close()
    })
    await scenario('Bruno proposes removing Carla; Ana approves; Carla is back to the explanation', async () => {
      const bruno = await as(42)
      await vault(bruno.page); await openAdministration(bruno.page, 42)
      await bruno.page.getByTestId('vault-administration-manager-43').click(); await proposed(bruno.page)
      await bruno.close()
      const ana = await as(41)
      await users(ana.page)
      await ana.page.getByTestId('users-vault-pending').filter({ hasText: '1 alteração do cofre aguarda sua aprovação.' }).waitFor()
      await (await rowAction(ana.page, 'carla@example.test', 'Permissões do cofre')).click()
      await unlock(ana.page, 41)
      await approve(ana.page, 'Retirar Carla Admin <carla@example.test> da gestão do cofre')
      await ana.close()
      check(!fixture.state.managers.has(43), 'Carla still a manager')
      const carla = await as(43)
      await vault(carla.page); await carla.page.getByTestId('vault-administration-not-manager').waitFor()
      await carla.close()
    })
    await scenario('Mobile: Users tab with the pending notice and the review window fit the screen', async () => {
      const bruno = await as(42, { mobile: true })
      await users(bruno.page)
      await bruno.page.getByTestId('users-vault-pending').waitFor()
      await review(bruno.page, bruno.errors, '07-mobile-users-pending')
      await bruno.page.getByTestId('users-vault-review').click()
      await unlock(bruno.page, 42)
      await review(bruno.page, bruno.errors, '08-mobile-review-modal')
      await bruno.close()
      const ana = await as(41, { mobile: true })
      await vault(ana.page); await openAdministration(ana.page, 41)
      await review(ana.page, ana.errors, '09-mobile-vault-administration')
      await ana.close()
    })
    const proposals = fixture.state.events.filter(e => e.type === 'POLICY_CHANGE_PROPOSED').length, applied = fixture.state.events.filter(e => e.type === 'POLICY_CHANGED').length
    check(applied === 4 && proposals === 5, `Unexpected audit trail: ${proposals} proposed / ${applied} applied`)
    return { status: 'passed', scenarios, count: scenarios.length, screenshots: screenshots.length, audit: { proposals, applied } }
  } finally {
    await Promise.allSettled([...contexts].map(context => context.close()))
  }
}
module.exports = { runVaultAdministrationFlow }
