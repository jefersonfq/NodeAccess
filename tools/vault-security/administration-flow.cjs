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
  const scenarios = [], contexts = new Set(), screenshots = [], requestFailures = [], timings = []
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
      else if (path === '/api/v1/secrets') body = fixture.secrets()
      else if (path === '/api/v1/pem-keys' || path.endsWith('/groups')) body = []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    const page = await context.newPage(), errors = []
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    // Diagnostics only (route and browser reason, no bodies): included in the failure message of a scenario.
    page.on('requestfailed', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/')) requestFailures.push(`${path} ${request.failure()?.errorText ?? ''}`.slice(0, 160)) })
    page.on('response', response => { const path = new URL(response.url()).pathname
      if (!path.startsWith('/api/v1/vault-security/') || path.startsWith('/api/v1/vault-security/extension/')) return
      const line = `${path} ${response.status()}`
      if (response.status() < 400) { timings.push(line); return }
      // Error code and body size only (never the request).
      // Shape of a refused request body: field names, lengths and base64url validity (never values).
      let shape = ''
      try {
        const describe = (o, prefix = '') => Object.entries(o ?? {}).map(([k, v]) => v && typeof v === 'object' ? describe(v, `${prefix}${k}.`)
          : `${prefix}${k}:${typeof v}${typeof v === 'string' ? `/${v.length}${/^[A-Za-z0-9_-]+$/.test(v) ? '' : '!'}` : ''}`).join(',')
        shape = describe(JSON.parse(response.request().postData() ?? '{}'))
      } catch { shape = 'unparsed' }
      timings.push(`${line} [${shape}]`.slice(0, 600)) })
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
    // Each instance (page section, user/item/review window) has its own ids; only one form is on screen here.
    await page.locator('input[id^="vault-administration-password"]:visible').fill(person(id).password)
    await page.locator('input[id^="vault-administration-otp"]:visible').fill(fixture.totp(id))
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
      throw new Error(`${name}: ${error.message} | failed requests: ${requestFailures.slice(-6).join('; ')} | last vault responses: ${timings.slice(-6).join('; ')}`.slice(0, 3000))
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
    // NA-0196: the user who cannot reveal is told why before any password; managers turn the tenant policy on, grant and
    // release an item from its row; the user then reveals. Every screen is reviewed for layout, noise and accessibility.
    const secretRow = (page, alias) => page.locator('tr.vault-row', { hasText: alias })
    async function itemDelivery(page, alias) {
      await page.getByRole('button', { name: `Ações: ${alias}`, exact: true }).click()
      const option = page.locator('.n-dropdown-option', { hasText: 'Entrega do item' })
      await option.first().waitFor(); await option.first().click()
    }
    await scenario('Davi sees why he cannot reveal or copy, before any password and without a vault prompt', async () => {
      const davi = await as(44)
      await vault(davi.page)
      await davi.page.getByTestId('vault-delivery-block').filter({ hasText: 'Revelar e copiar estão desligados neste tenant' }).waitFor()
      check(await secretRow(davi.page, 'secret-ssh-teste2').getByText('Indisponível', { exact: true }).count() === 1, 'Row does not say the item is unavailable')
      check(await davi.page.getByRole('button', { name: /^Revelar senha/ }).count() === 0, 'Reveal offered while the policy is off')
      check(await davi.page.getByTestId('vault-delivery-open-settings').count() === 0, 'A non-manager got the settings shortcut')
      check(await davi.page.locator('input[type="password"]').count() === 0, 'A password was asked with nothing to reveal')
      await review(davi.page, davi.errors, '10-user-policy-off')
      await davi.close()
    })
    await scenario('Ana turns reveal and copy on in Password delivery for the tenant; Bruno approves from the vault page', async () => {
      const ana = await as(41)
      await vault(ana.page)
      await ana.page.getByTestId('vault-delivery-open-settings').click()
      await openAdministration(ana.page, 41)
      const policy = ana.page.getByTestId('vault-administration-policy')
      await policy.getByText('Permitir revelar', { exact: true }).click(); await policy.getByText('Permitir copiar', { exact: true }).click()
      await ana.page.getByTestId('vault-administration-policy-propose').click(); await proposed(ana.page)
      await review(ana.page, ana.errors, '11-manager-policy-proposed')
      await ana.close()
      const bruno = await as(42)
      await vault(bruno.page)
      await bruno.page.getByTestId('vault-administration-pending-count').waitFor()
      await openAdministration(bruno.page, 42)
      await approve(bruno.page, 'Entrega no tenant: revelar ligado, copiar ligado')
      await bruno.close()
      check(fixture.state.policy.reveal === true && fixture.state.policy.copy === true, 'Tenant policy not applied')
      const davi = await as(44)
      await vault(davi.page)
      await davi.page.getByTestId('vault-delivery-block').filter({ hasText: 'Você ainda não tem permissão' }).waitFor()
      await review(davi.page, davi.errors, '12-user-no-permission')
      await davi.close()
    })
    await scenario('Ana proposes Reveal for Davi (Copy already waiting, no duplicate); Bruno approves both', async () => {
      const ana = await as(41)
      await vault(ana.page); await openAdministration(ana.page, 41)
      await ana.page.getByTestId('vault-administration-propose-44-reveal').click()
      await ana.page.getByTestId('vault-administration-waiting-44-reveal').waitFor()
      // Copy for Davi is still waiting from the 24 h scenario: the button gives way to "Awaiting approval" (no duplicate).
      check(await ana.page.getByTestId('vault-administration-propose-44-copy').count() === 0, 'Duplicate proposal offered')
      await ana.page.getByTestId('vault-administration-waiting-44-copy').waitFor()
      check(await proposal(ana.page, 'Davi Operador').count() === 2, 'Expected exactly one proposal per permission')
      await ana.close()
      const bruno = await as(42)
      await vault(bruno.page); await openAdministration(bruno.page, 42)
      await approve(bruno.page, 'Revelar para Davi Operador')
      // Each approval locks the vault for everyone: the second one needs the identity again.
      await unlock(bruno.page, 42)
      await approve(bruno.page, 'Copiar para Davi Operador')
      await bruno.close()
      const davi = await as(44)
      await vault(davi.page)
      await secretRow(davi.page, 'secret-ssh-teste2').getByText('Item não liberado', { exact: true }).waitFor()
      check(await davi.page.getByTestId('vault-delivery-block').count() === 0, 'General notice kept after the permissions were granted')
      await review(davi.page, davi.errors, '13-user-item-not-released')
      await davi.close()
    })
    await scenario('Ana releases secret-ssh-teste2 from its row (Actions → Item delivery); Bruno approves; Davi reveals', async () => {
      const ana = await as(41)
      await vault(ana.page)
      await itemDelivery(ana.page, 'secret-ssh-teste2')
      const modal = ana.page.getByTestId('vault-item-delivery-modal')
      await modal.getByText('Revelar e copiar: secret-ssh-teste2').waitFor()
      await unlock(ana.page, 41)
      await modal.getByText('secret-ssh-teste2 ainda não está liberado para revelar e copiar.').waitFor()
      check(await modal.locator('[data-testid^="vault-administration-user-"]').count() === 0, 'Item window lists users')
      await modal.getByTestId('vault-administration-item-propose').click(); await proposed(ana.page)
      await review(ana.page, ana.errors, '14-manager-item-window')
      await ana.close()
      const bruno = await as(42)
      await vault(bruno.page); await openAdministration(bruno.page, 42)
      await approve(bruno.page, 'Liberar secret-ssh-teste2 para revelar e copiar')
      await unlock(bruno.page, 42)
      await bruno.page.getByTestId('vault-administration-released-5').waitFor()
      await review(bruno.page, bruno.errors, '15-manager-released-list')
      await bruno.close()
      check(fixture.state.released.has(5) && !fixture.state.released.has(6), 'Item release not applied')
      const davi = await as(44)
      await vault(davi.page)
      const reveal = davi.page.getByRole('button', { name: 'Revelar senha: secret-ssh-teste2', exact: true })
      await reveal.waitFor()
      check(await davi.page.getByRole('button', { name: 'Copiar senha: secret-ssh-teste2', exact: true }).count() === 1, 'Copy not offered')
      check(await secretRow(davi.page, 'db-backup').getByText('Item não liberado', { exact: true }).count() === 1, 'Unreleased item lost its reason')
      await review(davi.page, davi.errors, '16-user-can-reveal')
      await reveal.click()
      await davi.page.locator('input[type="password"]').first().waitFor()
      await davi.close()
    })
    await scenario('Mobile: reasons in the list and the item window fit the screen', async () => {
      const davi = await as(44, { mobile: true })
      await vault(davi.page)
      await review(davi.page, davi.errors, '17-mobile-user-reasons')
      await davi.close()
      const ana = await as(41, { mobile: true })
      await vault(ana.page)
      await itemDelivery(ana.page, 'db-backup')
      await unlock(ana.page, 41)
      await ana.page.getByTestId('vault-administration-item').waitFor()
      await review(ana.page, ana.errors, '18-mobile-item-window')
      await ana.close()
    })
    // NA-0198: Windows Hello / passkey with Chromium's virtual platform authenticator (user verification on), on a host-name origin.
    async function authenticator(page, verified = true) {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('WebAuthn.enable')
      const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
        hasResidentKey: true, hasUserVerification: true, isUserVerified: verified, automaticPresenceSimulation: true } })
      return { verify: value => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: value }) }
    }
    await scenario('Ana registers Windows Hello, unlocks with it, a non-verified attempt is refused, then she removes it', async () => {
      const ana = await as(41)
      const device = await authenticator(ana.page)
      await vault(ana.page)
      await ana.page.getByTestId('vault-webauthn-open').click()
      const modal = ana.page.getByTestId('vault-webauthn-modal')
      await modal.getByText('Nenhum dispositivo cadastrado.').waitFor()
      await modal.locator('#vault-webauthn-name').fill('Notebook da Ana')
      await modal.getByTestId('vault-webauthn-register').click()
      await modal.getByTestId('vault-webauthn-confirm').waitFor()
      await modal.locator('#vault-webauthn-password').fill(person(41).password)
      await modal.locator('#vault-webauthn-otp').fill(fixture.totp(41))
      await modal.getByTestId('vault-webauthn-confirm-submit').click()
      await modal.getByTestId('vault-webauthn-done').waitFor()
      await modal.getByTestId('vault-webauthn-credential-Notebook da Ana').waitFor()
      check([...fixture.state.webauthn.values()].filter(c => c.userId === 41).length === 1, 'Credential not stored for Ana')
      check(fixture.state.events.some(e => e.type === 'WEBAUTHN_REGISTERED'), 'Registration not audited')
      await review(ana.page, ana.errors, '19-webauthn-registered')
      await ana.page.keyboard.press('Escape')
      // Unlock the managers section with Windows Hello instead of password + code.
      await ana.page.getByTestId('vault-administration-open').click()
      const hello = ana.page.getByTestId('vault-administration-webauthn')
      await hello.waitFor()
      check(await ana.page.locator('input[id^="vault-administration-password"]:visible').count() === 1, 'Password form gone while Windows Hello is offered')
      await review(ana.page, ana.errors, '20-webauthn-offered')
      const unlocked = fixture.state.events.filter(e => e.type === 'VAULT_UNLOCKED').length
      await hello.getByRole('button', { name: 'Usar Windows Hello / chave de acesso' }).click()
      await ana.page.getByTestId('vault-administration-lock').waitFor()
      check(fixture.state.events.filter(e => e.type === 'VAULT_UNLOCKED').length === unlocked + 1, 'Unlock not audited')
      // Without user verification the vault stays locked and the password form stays.
      await ana.page.getByTestId('vault-administration-lock').click()
      await device.verify(false)
      await hello.getByRole('button', { name: 'Usar Windows Hello / chave de acesso' }).click()
      await ana.page.locator('[role="alert"]').filter({ hasText: /Windows Hello|identidade/ }).first().waitFor()
      check(await ana.page.getByTestId('vault-administration-lock').count() === 0, 'Unlocked without a verified user')
      check(await ana.page.locator('input[id^="vault-administration-password"]:visible').count() === 1, 'Password form missing after a refused Windows Hello')
      check(await hello.count() === 1, 'Windows Hello not offered again after a refused attempt')
      await review(ana.page, ana.errors, '21-webauthn-refused')
      // Remove the device, confirming with Windows Hello; it is no longer offered.
      await device.verify(true)
      await ana.page.getByTestId('vault-webauthn-open').click()
      await modal.getByRole('button', { name: 'Remover: Notebook da Ana', exact: true }).click()
      await modal.getByTestId('vault-webauthn-confirm').getByRole('button', { name: 'Usar Windows Hello / chave de acesso' }).click()
      await modal.getByText('Dispositivo removido. Ele não destrava mais o cofre.').waitFor()
      check(fixture.state.webauthn.size === 0, 'Credential not removed')
      check(fixture.state.events.some(e => e.type === 'WEBAUTHN_REMOVED'), 'Removal not audited')
      await ana.page.keyboard.press('Escape')
      await vault(ana.page)
      await ana.page.getByTestId('vault-administration-open').click()
      await ana.page.locator('input[id^="vault-administration-password"]:visible').waitFor()
      check(await ana.page.getByTestId('vault-administration-webauthn').count() === 0, 'Windows Hello still offered after removal')
      await ana.close()
    })
    await scenario('Mobile: the Windows Hello window fits the screen', async () => {
      const bruno = await as(42, { mobile: true })
      await vault(bruno.page)
      await bruno.page.getByTestId('vault-webauthn-open').click()
      await bruno.page.getByTestId('vault-webauthn-modal').getByText('Nenhum dispositivo cadastrado.').waitFor()
      await bruno.page.waitForTimeout(400) // let the window finish opening before the screenshot
      await review(bruno.page, bruno.errors, '22-mobile-webauthn')
      await bruno.close()
    })
    const proposals = fixture.state.events.filter(e => e.type === 'POLICY_CHANGE_PROPOSED').length, applied = fixture.state.events.filter(e => e.type === 'POLICY_CHANGED').length
    check(applied === 8 && proposals === 8, `Unexpected audit trail: ${proposals} proposed / ${applied} applied`)
    return { status: 'passed', scenarios, count: scenarios.length, screenshots: screenshots.length, audit: { proposals, applied } }
  } finally {
    await Promise.allSettled([...contexts].map(context => context.close()))
  }
}
module.exports = { runVaultAdministrationFlow }
