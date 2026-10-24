
const assert=require('node:assert/strict')
module.exports=async({page,platform})=>{
  const name=platform==='Win32'?'Windows':platform==='MacIntel'?'macOS':'Linux'
  const preset=platform==='Win32'?'windows':platform==='MacIntel'?'macos':'linux'
  const banner=page.locator('[data-terminal-onboarding="true"]')
  await banner.getByText('Ajustes rápidos para '+name,{exact:true}).waitFor()
  const sockets=await page.evaluate(()=>window.__terminalExperience.sockets.length)
  await page.screenshot({path:'/tmp/terminal-onboarding-'+preset+'-before.png'})
  await banner.getByRole('button',{name:'Usar preset de '+name,exact:true}).click()
  await banner.waitFor({state:'hidden',timeout:3000})
  assert.equal(await page.evaluate(()=>localStorage.getItem('na_terminal_onboarding_dismissed')),'1')
  assert.equal(await page.evaluate(()=>localStorage.getItem('na_term_preset')),preset)
  assert.equal(await page.evaluate(()=>window.__terminalExperience.sockets.length),sockets,'Applying a preset reconnected the session')
  await page.screenshot({path:'/tmp/terminal-onboarding-'+preset+'-after.png'})
  await page.reload({waitUntil:'domcontentloaded'})
  await page.locator('[data-terminal-container="true"]').first().waitFor()
  assert.equal(await banner.count(),0,'Onboarding returned after reload')
  assert.deepEqual(await page.evaluate(()=>window.__terminalExperience.errors),[])
  return {ok:true,platform:name,applied:true,dismissed:true,persistsAfterReload:true,noReconnectOnApply:true}
}
