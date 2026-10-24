const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
module.exports = async ({page}) => {
  const out = '/tmp/nodeaccess-terminal-ai-command-' + (process.env.UI_THEME || 'dark')
  await fs.mkdir(out,{recursive:true})
  const runtimeErrors=[]
  page.on('pageerror',err=>runtimeErrors.push(err.message))
  page.on('console',message=>{if(message.type()==='error' && /Message compilation|Invalid linked/.test(message.text()))runtimeErrors.push(message.text())})
  let mode='normal', requests=[], release
  const response={correlationId:'00000000-0000-4000-8000-000000000042',kind:'command',title:'Portas em escuta',explanation:'Lista sockets TCP/UDP em escuta, endereços numéricos e processos quando disponíveis.',content:'ss -lntup',provider:'fixture',risk:'safe',canInsert:true,requiresApproval:false,warnings:[]}
  await page.route('**/api/v1/local-ai/terminal-assist',async route=>{
    requests.push(route.request().postDataJSON())
    const current=mode
    if(current.startsWith('failure:')){
      const code=current.slice(8)
      await route.fulfill({status:code==='AI_LICENSE'||code==='FORBIDDEN'?403:code==='AI_RATE_LIMIT'?429:502,contentType:'application/json',body:JSON.stringify({code,message:'Provider detail must not be shown'})})
      return
    }
    if(current==='delay')await new Promise(resolve=>{release=resolve})
    const body=current==='blocked'?{...response,risk:'blocked',canInsert:false}:current==='approval'?{...response,risk:'approval_required',requiresApproval:true}:current==='multiline'?{...response,content:'pwd\nwhoami'}:current==='quoted'?{...response,content:'"ss -lntup"'}:current==='control'?{...response,content:'pwd\x1b[A'}:{...response}
    if(current==='alternatives')body.alternatives=[
      {content:'netstat -lnt',explanation:'Lista portas TCP.',risk:'safe',canInsert:true,requiresApproval:false},
      {content:'reboot',explanation:'Bloqueado.',risk:'blocked',canInsert:true,requiresApproval:false}]
    await route.fulfill({status:current==='error'?503:200,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{})
  })
  const input=page.locator('.xterm-helper-textarea').first()
  const quick=page.getByTestId('terminal-command-suggestion')
  const sent=()=>page.evaluate(()=>window.__terminalExperience.inputSent.join(''))
  await page.waitForFunction(()=>window.__NODEACCESS_TERMINAL_HARNESS__?.flags.ready)
  async function open(prefix='@ia '){
    await input.focus()
    await input.press('Control+U')
    await input.pressSequentially(prefix,{delay:12})
    await quick.waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'combobox')
  }
  async function ask(){
    await quick.getByRole('combobox',{name:'O que você quer fazer?',exact:true}).fill('comando para ver portas no linux')
    await quick.getByRole('combobox',{name:'O que você quer fazer?',exact:true}).press('Enter')
  }
  // No request/intent reaches SSH; choosing and executing are separate user events.
  await input.focus();await input.press('Control+U');await input.pressSequentially('@ia',{delay:12})
  await page.getByTestId('terminal-ai-shortcuts').waitFor()
  assert.match(await page.getByTestId('terminal-ai-shortcuts').innerText(),/@ia-ass/)
  await page.screenshot({path:out+'/shortcuts.png',fullPage:true})
  await input.press('Space')
  await quick.waitFor()
  await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='combobox')
  const before=await sent()
  await page.keyboard.type('comando para ver portas no linux')
  await page.keyboard.press('Enter')
  const choice=quick.getByTestId('terminal-ai-command-choice')
  await choice.waitFor()
  assert.equal(await sent(),before)
  assert.equal(requests.at(-1).intent,'command')
  assert.equal(requests.at(-1).terminalContext,undefined)
  assert.match(await choice.innerText(),/ss -lntup.*Lista sockets/s)
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900})
    await page.screenshot({path:out+'/suggestion-'+width+'.png',fullPage:true})
    const pane=page.locator('[data-terminal-container="true"]').first()
    const bounds=await pane.boundingBox()
    const card=await quick.boundingBox()
    assert.ok(card.y>=bounds.y-1 && card.y+card.height<=bounds.y+bounds.height+1,'suggestions remain inside terminal')
    assert.equal(await quick.evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1 && el.getBoundingClientRect().left>=0),true)
  }
  await choice.press('Enter')
  await quick.waitFor({state:'detached'})
  assert.equal((await sent()).slice(before.length),'ss -lntup')
  await input.press('Enter')
  assert.match((await sent()).slice(before.length),/^ss -lntup[\r\n]$/)
  // Empty/short questions and IME confirmation must not make requests.
  await open()
  const requestCount=requests.length
  await quick.getByRole('combobox').fill('oi')
  await quick.getByRole('combobox').press('Enter')
  assert.equal(requests.length,requestCount)
  await quick.getByRole('combobox').fill('Liste portas')
  await quick.getByRole('combobox').dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})
  assert.equal(requests.length,requestCount)
  await quick.getByRole('combobox').press('Escape')
  // Keyboard navigation chooses a policy-approved alternative without touching SSH.
  await page.setViewportSize({width:1440,height:900})
  mode='alternatives';await open();const alternativeBefore=await sent();await ask()
  await quick.getByRole('option').nth(1).waitFor()
  assert.equal(await quick.getByRole('option').count(),2)
  const box=quick.getByRole('combobox')
  await box.press('ArrowUp')
  assert.equal(await quick.getByRole('option').nth(1).getAttribute('aria-selected'),'true')
  await box.press('ArrowDown')
  assert.equal(await quick.getByRole('option').nth(0).getAttribute('aria-selected'),'true')
  await box.press('ArrowDown')
  await box.dispatchEvent('keydown',{key:'Enter',repeat:true,bubbles:true})
  assert.equal(await quick.count(),1)
  assert.equal(await sent(),alternativeBefore)
  await box.press('Enter')
  await quick.waitFor({state:'detached'})
  assert.equal((await sent()).slice(alternativeBefore.length),'netstat -lnt')
  mode='normal'
  // Context prefix must open the original assistant directly.
  await input.focus();await input.press('Control+U')
  await input.pressSequentially('@ia-ass ',{delay:12})
  await page.getByTestId('terminal-inline-ai').waitFor()
  assert.equal(await quick.count(),0)
  await page.getByTestId('terminal-inline-ai').getByRole('button',{name:'Fechar assistente',exact:true}).click()
  // Canceling a result sends nothing.
  await open('@ai ')
  const cancelBefore=await sent()
  await ask();await choice.waitFor()
  await choice.press('Escape');await quick.waitFor({state:'detached'})
  assert.equal(await sent(),cancelBefore)
  // Failure keeps question and supports retry.
  await open();mode='error';await ask()
  await quick.getByRole('alert').waitFor()
  assert.equal(await quick.getByRole('combobox').inputValue(),'comando para ver portas no linux')
  mode='normal'
  await quick.getByRole('button',{name:'Tentar novamente',exact:true}).click()
  await choice.waitFor()
  await choice.press('Escape')
  // Explicit recovery distinguishes license/configuration from retryable failures.
  for(const code of ['AI_LICENSE','FORBIDDEN','AI_RATE_LIMIT','AI_RESPONSE_INVALID','AI_PROVIDER_CONFIGURATION']){
    mode='failure:'+code;await open();await ask();await quick.getByRole('alert').waitFor()
    const text=await quick.getByRole('alert').innerText()
    assert.ok(!text.includes('Provider detail'))
    assert.equal(await quick.getByRole('combobox').inputValue(),'comando para ver portas no linux')
    const retryable=['AI_RATE_LIMIT','AI_RESPONSE_INVALID'].includes(code)
    if(retryable) assert.equal(await quick.getByRole('button',{name:'Tentar novamente',exact:true}).isEnabled(),true)
    else assert.equal(await quick.getByRole('button',{name:'Sugerir comando',exact:true}).isDisabled(),true)
    await quick.getByRole('button',{name:'Fechar',exact:true}).click()
  }
  // Do not trust canInsert alone or accept control characters/multiline.
  for(const invalid of ['blocked','approval','multiline','control','quoted']){
    mode=invalid;await open();const baseline=await sent();await ask()
    await quick.getByTestId('terminal-ai-rejection').waitFor()
    const reason=await quick.getByTestId('terminal-ai-rejection').innerText()
    assert.match(reason,invalid==='blocked'?/bloqueou/:invalid==='approval'?/exige aprovação/:/formato/)
    assert.ok((await quick.getByTestId('terminal-ai-rejected-content').innerText()).length>0)
    assert.equal(await choice.count(),0);assert.equal(await sent(),baseline)
    await quick.getByRole('button',{name:'Fechar',exact:true}).click()
  }
  // Repeated submit while pending does not issue duplicates; closing ignores late data.
  mode='delay';await open();await ask()
  await page.waitForTimeout(50)
  const count=requests.length
  await quick.getByRole('combobox').press('Enter')
  assert.equal(requests.length,count)
  await quick.getByRole('button',{name:'Fechar',exact:true}).click()
  release();await page.waitForTimeout(150)
  assert.equal(await quick.count(),0)
  // Editing a pending question invalidates the old response.
  await open();await ask();await page.waitForTimeout(50)
  await quick.getByRole('combobox').fill('Outro pedido')
  release();await page.waitForTimeout(150)
  assert.equal(await choice.count(),0)
  await quick.getByRole('button',{name:'Fechar',exact:true}).click()
  mode='normal'
  // Context assistant remains available, with a compilable translated opening.
  await input.focus();await input.press('Control+Shift+I')
  const assistant=page.getByTestId('terminal-inline-ai')
  await assistant.waitFor()
  await assistant.getByText(/A IA recebe os dados do host/).waitFor()
  await assistant.getByRole('button',{name:'Fechar assistente',exact:true}).click()
  // Context scope is explicit; no duplicate buffer or text leaks in 'none'.
  await input.focus();await input.pressSequentially('@ia-ass ',{delay:12})
  await assistant.waitFor()
  for(const scope of ['none','recent','both','selection']){
    mode='normal'
    await assistant.getByTestId('terminal-ai-context-mode').selectOption(scope)
    await assistant.getByTestId('terminal-ai-prompt').locator('textarea').fill('Analise este terminal')
    await assistant.getByTestId('terminal-ai-send').click()
    await page.waitForFunction(()=>document.querySelector('[data-testid="terminal-ai-prompt"] textarea')?.value==='')
    const context=requests.at(-1).terminalContext
    assert.equal(context.bufferTail,null)
    if(scope==='none'||scope==='selection')assert.equal(context.recentOutput,null)
    if(scope==='none'||scope==='recent')assert.equal(context.selection,null)
    assert.ok((context.selection?.length||0)+(context.recentOutput?.length||0)<=8000)
  }
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900})
    await page.screenshot({path:out+'/context-'+width+'.png',fullPage:true})
  }
  await page.setViewportSize({width:1440,height:900})
  mode='failure:AI_RESPONSE_INVALID'
  await assistant.getByTestId('terminal-ai-prompt').locator('textarea').fill('Repetir pergunta após falha')
  await assistant.getByTestId('terminal-ai-send').click()
  await assistant.getByTestId('terminal-ai-error').waitFor()
  assert.equal(await assistant.getByTestId('terminal-ai-prompt').locator('textarea').inputValue(),'Repetir pergunta após falha')
  const failureRequests=requests.length
  await page.waitForTimeout(100)
  assert.equal(requests.length,failureRequests)
  mode='normal';await assistant.getByTestId('terminal-ai-send').click()
  await page.waitForFunction(()=>document.querySelector('[data-testid="terminal-ai-prompt"] textarea')?.value==='')
  // Explicit cancellation keeps the question; a late provider answer is ignored.
  mode='delay'
  await assistant.getByTestId('terminal-ai-prompt').locator('textarea').fill('Pergunta pendente')
  await assistant.getByTestId('terminal-ai-send').click()
  await page.waitForTimeout(80)
  await assistant.getByTestId('terminal-ai-cancel').click()
  release();await page.waitForTimeout(100)
  assert.equal(await assistant.getByTestId('terminal-ai-prompt').locator('textarea').inputValue(),'Pergunta pendente')
  await assistant.getByRole('button',{name:'Fechar assistente',exact:true}).click()
  mode='normal'
  // Reject insertion when user changes the terminal line behind the popup.
  await open();await ask();await choice.waitFor()
  await input.focus();await input.pressSequentially('echo existing')
  const changedBefore=await sent()
  await choice.click()
  await quick.waitFor({state:'detached'})
  assert.equal(await sent(),changedBefore)
  await input.press('Control+U')
  // Ctrl+C clears the tracked input; the next explicit prefix must still work.
  await input.focus();await input.pressSequentially('echo partial')
  await input.press('Control+C');await input.pressSequentially('@ia ',{delay:12})
  await quick.waitFor()
  await quick.getByRole('button',{name:'Fechar',exact:true}).click()
  // A response is scoped to its original tab, even while the request is pending.
  mode='delay';await open();await ask();await page.waitForTimeout(100)
  const otherId=await page.evaluate(async()=>{
    const {useTerminalStore}=await import('/src/stores/terminals.ts')
    return useTerminalStore().add({id:9501,name:'Outro host',ip:'192.0.2.2',port:22,authType:'password',accessProtocol:'ssh'})
  })
  await quick.waitFor({state:'detached'})
  release();await page.waitForTimeout(150)
  assert.equal(await quick.count(),0)
  await page.evaluate(async id=>{const {useTerminalStore}=await import('/src/stores/terminals.ts');useTerminalStore().remove(id)},otherId)
  // Network/provider timeout retains the question and never inserts late output.
  mode='delay';await open();await ask()
  await quick.getByText('A IA demorou para responder. Tente novamente.',{exact:true}).waitFor({timeout:25000})
  release();await page.waitForTimeout(150)
  assert.equal(await choice.count(),0)
  await quick.getByRole('button',{name:'Fechar',exact:true}).click()
  // Disconnect invalidates both pending and visible suggestions.
  mode='delay';await open();await ask();await page.waitForTimeout(50)
  await page.evaluate(()=>window.__terminalExperience.sockets.find(s=>s.url.includes('/ws/ssh/')).emitControl({type:'closed',reason:'SSH_CHANNEL_CLOSED',message:'closed'}))
  await quick.waitFor({state:'detached'})
  release();await page.waitForTimeout(150)
  assert.equal(await quick.count(),0)
  assert.ok(!(await sent()).includes('@ia'))
  assert.ok(!(await sent()).includes('@ai'))
  assert.ok(!(await sent()).includes('comando para ver portas'))
  assert.deepEqual(runtimeErrors,[])
  return {ok:true,contextScopes:true,contextCancel:true,errorRecovery:true,shortcutDiscovery:true,automaticFocus:true,imeAndRepeat:true,shortQuestion:true,arrowNavigation:true,contextPrefix:true,alternativePolicy:true,prefixes:true,portsSuggestion:true,noBufferSent:true,chooseWithoutEnter:true,userEnterExecutes:true,cancel:true,errorRetry:true,policy:true,controlCharactersBlocked:true,doubleSubmit:true,lateResponseIgnored:true,editInvalidates:true,changedLineBlocked:true,disconnect:true,ctrlCRecovery:true,sessionSwitch:true,providerTimeout:true,contextOpening:true,viewports:[1440,768,390],screenshots:out,errors:runtimeErrors}
}
