const assert = require('node:assert/strict')
module.exports = async ({page, context}) => {
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const original = await page.evaluate(() => localStorage.getItem('na_access_token'))
  const claims = JSON.parse(Buffer.from(original.split('.')[1], 'base64url'))
  const tenants = [1,2].map(id => ({id,name:id===1?'Tenant padrão teste':'Outro tenant teste',slug:`tenant-${id}`,active:true,activeUsers:1,maxUsers:50}))
  const calls = []
  await context.route('**/api/v1/platform/tenants', route => route.fulfill({json:tenants}))
  await context.route('**/api/v1/platform/tenants/dashboard', route => route.fulfill({json:null}))
  await context.route('**/api/v1/auth/platform/*-tenant', route => {
    const request = route.request(), {tenantId} = request.postDataJSON()
    calls.push({path:new URL(request.url()).pathname,tenantId})
    if(request.url().endsWith('/exit-tenant')) return route.fulfill({json:{ok:true}})
    const payload = {...claims,tenantId,actingTenantId:tenantId,platformTenantId:1,impersonatedByUserId:1}
    return route.fulfill({json:{accessToken:`${original.split('.')[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.mock`,tenant:tenants.find(t=>t.id===tenantId)}})
  })
  const navigate = path => page.evaluate(async path => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path)
  }, path)
  const banner = page.getByText(/Modo delegado ativo:/)
  const sshCount = () => page.evaluate(() => window.__terminalExperience.sockets.filter(s=>s.url.includes('/ws/ssh/')).length)
  const connections = await sshCount()
  await navigate('/hosts')
  await page.locator('[data-open-session-host-id]').waitFor()
  const originalCard = await page.locator('[data-open-session-host-id]').getAttribute('data-open-session-host-id')
  for(let cycle=0;cycle<2;cycle++) {
    await navigate('/platform/tenants')
    await page.getByText('Outro tenant teste',{exact:true}).first().waitFor({timeout:15000}).catch(async e=>{console.log({url:page.url(),errors,body:(await page.locator('body').innerText()).slice(-3500)});throw e})
    if(process.env.MANUAL_CAPTURE==='1' && cycle===0) { await page.waitForTimeout(500);await page.screenshot({path:'/tmp/nodeaccess-manual-review/tenants.png'}) }
    await page.getByRole('row').filter({hasText:'Outro tenant teste'}).getByRole('button',{name:'Gerenciar',exact:true}).click()
    await banner.waitFor()
    await navigate('/hosts')
    await page.waitForTimeout(200)
    assert.equal(await page.locator('[data-open-session-host-id]').count(),0,'Other tenant must not show the original session')
    await navigate('/platform/tenants')
    await page.getByRole('row').filter({hasText:'Tenant padrão teste'}).getByRole('button',{name:'Gerenciar',exact:true}).click()
    await banner.waitFor({state:'hidden'})
    await navigate('/hosts')
    await page.locator('[data-open-session-host-id]').waitFor()
    assert.equal(await page.locator('[data-open-session-host-id]').getAttribute('data-open-session-host-id'),originalCard)
    assert.equal(await page.evaluate(()=>localStorage.getItem('na_access_token')),original)
    assert.equal(await page.evaluate(()=>localStorage.getItem('na_platform_access_token')),null)
    assert.equal(await sshCount(),connections)
  }
  assert.deepEqual(calls.map(c=>[c.path.endsWith('/enter-tenant')?'enter':'exit',c.tenantId]),[['enter',2],['exit',2],['enter',2],['exit',2]])
  assert.deepEqual(errors,[])
  await page.screenshot({path:'/tmp/nodeaccess-tenant-return.png'})
  return {passed:true,cycles:2,originalTokenRestored:true,noSelfDelegation:true,sessionHiddenInOtherTenant:true,sessionRestoredAtHome:true,noReconnection:true}
}
