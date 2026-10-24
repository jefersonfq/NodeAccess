#!/usr/bin/env node
// Isolated browser acceptance: every API and WebSocket is mocked; never touches client hosts.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')

const base = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const output = process.env.HOST_FORM_ARTIFACTS || '/tmp/nodeaccess-host-duplicate'
const timestamp = '2026-10-22T12:00:00.000Z'
const original = { id: 21, tenantId: 7, name: 'Host de demonstração', ip: '192.0.2.21', port: 2222,
  accessProtocol: 'ssh', operatingSystem: 'linux', sshUser: 'ops', authType: 'password', connectionMode: 'direct',
  scope: 'personal', ownerId: 41, groupId: null, folderId: null, inventoryParentId: 800, bastionId: null,
  pemKeyId: null, passwordSecretId: null, hasPasswordCredential: true, description: null,
  onePasswordRef: null, startupSnippetId: null, startupSnippetMode: 'disabled', tags: [], associatedLinks: [],
  accessPermissions: { view: true, connect: true, edit: true, admin: true }, createdAt: timestamp, updatedAt: timestamp }
const tabs = ['Conexão', 'Acesso', 'Organização', 'Recursos']
const tabKeys = ['connection', 'access', 'organization', 'resources']
const results = []
const startedAt = new Date().toISOString()
function gitRef(...args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}
const revision = {
  changeId: 'NA-0062',
  branch: process.env.GITHUB_HEAD_REF || gitRef('branch', '--show-current'),
  testedSha: gitRef('rev-parse', 'HEAD'),
  baseSha: '66444a9dd4c167453004bb6089278548bdd2c0d9',
  nodeVersion: process.version,
}

async function main() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  try {
    for (const theme of (process.env.HOST_FORM_THEMES || 'dark,light').split(',')) for (const width of (process.env.HOST_FORM_WIDTHS || '1440,768,390').split(',').map(Number)) {
      const height = Number(process.env.HOST_FORM_HEIGHT || (width === 390 ? 844 : 960))
      const context = await browser.newContext({ viewport: { width, height }, locale: 'pt-BR', colorScheme: theme })
      const state = { host: { ...original, description:'Source notes', folderId:process.env.HOST_DUPLICATE_MISSING_FOLDER?999:width===390?null:600,
        passwordSecretId:width===390?null:91,startupSnippetId:51,startupSnippetMode:'suggest',
        tags:[{id:1,name:'production',color:'#123456'}],
        associatedLinks:[{id:44,label:'Console',urlTemplate:'https://example.test/hosts/{{HOST.IP}}',position:0,enabled:true,openMode:'new_tab',sourceType:'integration',sourceProvider:'onepassword',sourceRef:'external-old',sourceStatus:'synced'}],
      }, writes: [], tests: [], failSave: false, failTest: false, failRead: true }
      const errors = []
      const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '41', userId: 41, tenantId: 7, name: 'Admin demonstração', role: process.env.HOST_DUPLICATE_READONLY?'user':'admin', email: 'demo@example.test', stage: 'authenticated', iat: 1, exp: 4102444800 })).toString('base64url')}.fixture`
      await context.addInitScript(({ token, theme }) => {
        localStorage.setItem('na_access_token', token)
        localStorage.setItem('na_refresh_token', 'fixture')
        localStorage.setItem('na_hosts_default_view', 'all')
        localStorage.setItem('na_ui_theme_mode', theme)
        localStorage.setItem('nodeaccess_locale', 'pt-BR')
      }, { token, theme })
      await context.routeWebSocket(/.*/, socket => socket.close())
      await context.route('**/api/v1/**', async route => {
        const req = route.request(), url = new URL(req.url()).pathname
        let body = [], status = 200
        if (url === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 1, global: 0, unfiled: 0, maxHosts: 50, folders: {}, groups: {}, tags: {} }, folders: [{id:600,name:'Personal folder',parentId:null}], groups: [], tags: [{id:1,name:'production',color:'#123456'}] }
        else if (url === '/api/v1/hosts/test-connection') {
          state.tests.push(req.postDataJSON())
          body = state.failTest ? { success: false, latencyMs: null, message: 'Falha simulada de conexão', error: 'ECONNREFUSED' } : { success: true, latencyMs: 12, message: 'Conexão realizada com sucesso' }
        } else if ((url === '/api/v1/hosts' && req.method() === 'POST') || (url === '/api/v1/hosts/21' && req.method() === 'PATCH')) {
          state.writes.push({ method: req.method(), payload: req.postDataJSON(), failed: state.failSave })
          if (state.failSave) { status = state.failSave===403?403:500; body = { message: 'Falha simulada ao salvar' } }
          else { body = { ...state.host, ...req.postDataJSON(),id:99 }; await new Promise(resolve=>setTimeout(resolve,150)) }
        } else if (url === '/api/v1/hosts') body = { data: [state.host], total: 1, page: 1, limit: 20, totalPages: 1 }
        else if (url === '/api/v1/hosts/21') { if(state.failRead){status=403;body={message:'Access denied'}}else body=state.host }
        else if (url === '/api/v1/inventory') body = [{ id: 800, parentId: null, type: 'ROOT', name: 'Infraestrutura', path: '/Infraestrutura', depth: 0 }, { id: 801, parentId: 800, type: 'HOST', hostId: 21, name: state.host.name, path: '/Infraestrutura/demo', depth: 1 }]
        else if (url === '/api/v1/secrets') body = [{ id: 91, alias: 'Secret de demonstração', scope: 'PERSONAL', ownerId: 41, tenantId: 7, createdAt: timestamp }]
        else if (url === '/api/v1/pem-keys') body = [{ id: 31, name: 'PEM de demonstração', scope: 'personal', ownerId: 41, createdAt: timestamp }]
        else if (url === '/api/v1/snippets') body = [{ id: 51, name: 'Macro de demonstração', command: 'printf fixture', scope: 'personal', ownerId: 41 }]
        else if (url === '/api/v1/sessions/access-map') body = { generatedAt: timestamp, refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
        else if (url === '/api/v1/features') body = { secrets: true }
        else if (url === '/api/v1/settings') body = { tenant: { id: 7, name: 'Demonstração', slug: 'demo' }, license: { maxUsers: 10, maxHosts: 50, activeUsers: 1, registeredHosts: 1, hasKey: true, featureEntitlements: { secrets: true }, integrationEntitlements: {} } }
        else if (url === '/api/v1/integrations/onepassword/status') body = { active: false }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      page.on('pageerror', error => errors.push(error.message))
      const modal = page.getByTestId('host-form-modal')
      const tab = name => modal.locator('#host-form-tab-' + tabKeys[tabs.indexOf(name)])
      const field = label => modal.getByLabel(label, { exact: true })
      const choose = async (control, option) => { await control.click(); await page.locator('.n-base-select-option').filter({ hasText: option }).filter({ visible: true }).getByText(option, { exact: true }).click() }
      const save = () => modal.getByRole('button', { name: /^(Salvar|Criar|Save|Create)$/ }).click()
      const screenshot = async suffix => {
        if (/^(create|edit|duplicate)-/.test(suffix)) {
          await page.locator('.n-message').last().waitFor({ state: 'hidden', timeout: 10000 })
          await modal.locator('.host-form-scroll').evaluate(el => { el.scrollTop = 0 })
        }
        return page.screenshot({ path: path.join(output, `${theme}-${width}-${suffix}.png`), fullPage: true })
      }

      try {
        await page.goto(base+'/hosts',{waitUntil:'domcontentloaded'})
        await page.getByText('Ver todos os hosts →',{exact:true}).click()
        const sourceRow=page.locator('[data-host-id="21"]').first()
        await sourceRow.waitFor()
        await sourceRow.click({button:'right'})
        if(process.env.HOST_DUPLICATE_READONLY){
          assert.equal(await page.getByText('Duplicar host',{exact:true}).count(),0)
          assert.equal(state.writes.length,0)
          results.push({theme,width,ok:true,withoutCreateCapabilityCannotDuplicate:true})
          continue
        }
        await page.getByText('Duplicar host',{exact:true}).last().click()
        await page.getByText('Não foi possível carregar o host para duplicação. Tente novamente.',{exact:true}).waitFor()
        assert.equal(await modal.count(),0,'Denied source opened a draft')
        state.failRead=false
        await sourceRow.click({button:'right'})
        await page.getByText('Duplicar host',{exact:true}).last().click()

        await modal.waitFor()
        assert.equal(await field('Nome').inputValue(),original.name+' (cópia)')
        assert.equal(await field('Endereço IP / Hostname').inputValue(),'')
        assert.equal(await field('Porta').inputValue(),'2222')
        await modal.locator('[data-host-duplicate-notice]').waitFor()
        assert.equal(state.writes.length,0)
        await save()
        await modal.locator('.host-form-error').waitFor()
        assert.equal(state.writes.length,0,'Blank address created a host')
        await field('Endereço IP / Hostname').fill('192.0.2.99')
        if(width===390){
          assert.equal(await modal.locator('#host-form-password').inputValue(),'')
          await modal.locator('#host-form-password').fill('fixture-new-password')
        }
        if(process.env.HOST_DUPLICATE_MISSING_FOLDER){
          await save()
          await modal.locator('.host-form-error').getByText('Uma pasta, rota ou credencial copiada não está disponível. Revise as referências antes de salvar.',{exact:true}).waitFor()
          assert.equal(state.writes.length,0)
          results.push({theme,width,ok:true,unavailableFolderBlocked:true})
          continue
        }
        await tab('Recursos').click()
        await screenshot('duplicate-resources')
        await tab('Conexão').click()
        await screenshot('duplicate-connection')
        state.failSave=403
        await save()
        await modal.locator('.host-form-error').getByText('Falha simulada ao salvar',{exact:true}).waitFor()
        assert.equal(await field('Endereço IP / Hostname').inputValue(),'192.0.2.99','Denied save lost draft')
        state.failSave=false
        const saveButton=modal.getByRole('button',{name:/^(Salvar|Criar|Save|Create)$/})
        // Two DOM clicks in one tick must create just one request.
        await saveButton.evaluate(button=>{button.click();button.click()})
        await modal.waitFor({state:'hidden'})
        assert.equal(state.writes.length,2,'Duplicate save sent multiple requests')
        const {method,payload}=state.writes.at(-1)
        assert.equal(method,'POST')
        assert.equal(payload.ip,'192.0.2.99')
        assert.equal(payload.port,2222)
        assert.equal(payload.description,'Source notes')
        assert.equal(payload.inventoryParentId,800)
        assert.equal(payload.folderId,width===390?undefined:600)
        assert.deepEqual(payload.tagNames,['production'])
        assert.equal(payload.startupSnippetId,51)
        assert.equal(payload.startupSnippetMode,'suggest')
        assert.equal(payload.passwordSecretId,width===390?null:91)
        assert.equal(payload.associatedLinks[0].urlTemplate,'https://example.test/hosts/{{HOST.IP}}')
        assert.equal(payload.associatedLinks[0].sourceType,'manual')
        for(const key of ['id','sourceRef','sourceProvider'])assert.equal(key in payload.associatedLinks[0],false)
        for(const key of ['id','tenantId','accessPermissions','trustedHostKeyFingerprint'])assert.equal(key in payload,false)
        assert.equal(state.host.ip,original.ip,'Original host changed')
        assert.equal(state.host.associatedLinks[0].sourceType,'integration')
        await sourceRow.locator('[data-host-actions-button="true"]').click()
        await page.getByText('Duplicar host',{exact:true}).last().click()
        await modal.waitFor()
        await modal.getByRole('button',{name:'Cancelar',exact:true}).click()
        await modal.waitFor({state:'hidden'})
        assert.equal(state.writes.length,2,'Cancel saved a host')
        assert.deepEqual(errors,[])
        results.push({theme,width,ok:true,sourceDeniedNoDraft:true,retrySource:true,rightClick:true,actionsMenu:true,copiedRelations:true,newIdentity:true,originalUnchanged:true,blankAddressBlocked:true,permissionFailurePreservesDraft:true,doubleSaveSingleRequest:true,cancelNoWrite:true})
        console.log(JSON.stringify(results.at(-1)))
      } catch(error){
        await screenshot('failure')
        await fs.writeFile(path.join(output,theme+'-'+width+'-failure.txt'),await page.locator('body').innerText())
        console.error(errors);throw error
      } finally {await context.close()}
    }
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({ok:true,results},null,2))
  } finally {await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
