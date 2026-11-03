#!/usr/bin/env node
// Synthetic DOM fixtures built from the actual reviewed Vue control/label markup.
const { readIssue, publicIssue } = require('../shared/sonar-issue-id.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { parse } = require('@vue/compiler-sfc')
const { baseParse, parserOptions } = require('@vue/compiler-dom')
const { chromium } = require('playwright')
const { parseFixtureExpression } = require('./sonar-fixture-expression.cjs')
const gitExecutable = '/usr/bin/git'
assert(fs.existsSync(gitExecutable), 'This WSL/Linux review harness requires /usr/bin/git')
const root = path.resolve(__dirname, '../..')
const canonicalOutput = path.join(root, 'docs/changes/2026/11/NA-0087-sonar-frontend')
const output = process.env.SONAR_REVIEW_OUTPUT ? path.resolve(process.env.SONAR_REVIEW_OUTPUT) : canonicalOutput
const issues = JSON.parse(fs.readFileSync(process.env.SONAR_ASSIGNED || path.join(canonicalOutput, 'dispositions.json'), 'utf8')).map(readIssue).map(issue => ({...issue, component:issue.component || `nodeaccess:${issue.file}`, line:issue.line ?? issue.baselineLine}))
const parent = new WeakMap()
function nodes(node, result = []) { if (node.type === 1) result.push(node); for (const child of node.children || []) { parent.set(child, node); nodes(child, result) } return result }
function tree(source) { const template = parse(source).descriptor.template; return { all: nodes(baseParse(template.content, parserOptions)), offset: template.loc.start.line - 1 } }
const prop = (node, name) => node.props.find(p => p.type === 6 ? p.name === name : p.arg?.content === name)
const value = p => p?.type === 6 ? p.value?.content : p?.exp?.content
const model = node => value(node.props.find(p => p.type === 7 && p.name === 'model'))
const identity = node => model(node) ?? value(prop(node,'value')) ?? value(prop(node,'checked'))
function expression(source) { try { return parseFixtureExpression(source) } catch { return 'Campo de demonstração' } }
function attrs(node) {
 const result = {}
 for (const p of node.props) {
  const name = p.type === 6 ? p.name : p.arg?.content
  if (!['id','for','label','aria-label','aria-labelledby','type','autocomplete','filterable','multiple','input-props'].includes(name)) continue
  result[name === 'input-props' ? 'inputProps' : name] = p.type === 6 ? p.value?.content ?? true : expression(p.exp?.content)
 }
 if(node.tag === 'NSelect') result.options = [{label:'Exemplo A',value:'a'},{label:'Exemplo B',value:'b'}]
 return result
}
function spec(node) {
 if(node.type === 2) return node.content
 if(node.type === 5) return String(expression(node.content.content))
 if(node.type !== 1 || ['NTooltip','template','button'].includes(node.tag)) return null
 const tag = ['input','select','option','label','span','div','p','section','NSelect','NInputNumber','NInput','NCheckbox','NSwitch'].includes(node.tag) ? node.tag : 'span'
 return {tag,props:attrs(node),children:(node.children || []).map(spec).filter(x=>x!==null)}
}
const fixtures = []
for (const issue of issues.filter(i => i.rule === 'Web:S6853')) {
 const file = issue.component.split(':').slice(1).join(':')
 const before = tree(execFileSync(gitExecutable,['show',`3aa551378:${file}`],{cwd:root,encoding:'utf8'}))
 const after = tree(fs.readFileSync(path.join(root,file),'utf8'))
 const oldLabel = before.all.find(n => n.tag === 'label' && n.loc.start.line + before.offset === issue.line)
 assert(oldLabel, `baseline label ${file}:${issue.line}`)
 let oldControl = nodes(oldLabel,[]).find(n => /^N(Input|Select|Checkbox|Switch)/.test(n.tag))
 if (!oldControl) oldControl = nodes(parent.get(oldLabel),[]).find(n => /^N(Input|Select|Checkbox|Switch)/.test(n.tag))
 assert(oldControl, `control ${file}:${issue.line}`)
 const matches = n => n.tag === oldControl.tag && identity(n) === identity(oldControl)
 const candidates = after.all.filter(matches)
 const occurrence = before.all.filter(matches).indexOf(oldControl)
 assert(candidates.length, `current control ${file}:${issue.line}`)
 const control = candidates[occurrence]
 assert(control, `current occurrence ${file}:${issue.line}`)
 let wrapper = parent.get(control)
 while (wrapper && wrapper.tag !== 'label' && wrapper.tag !== 'section' && wrapper.tag !== 'div') wrapper = parent.get(wrapper)
 // External sibling labels and generated control IDs must stay in the same fixture.
 const fixture = spec(wrapper?.tag === 'label' || !model(oldControl) || prop(control,'input-props') && Object.hasOwn(expression(value(prop(control,'input-props'))), 'id') ? wrapper : control)

 fixtures.push({key:issue.key,file,line:issue.line,control:control.tag,spec:fixture})
}
const nativeFixtures = []
for (const issue of issues.filter(i => ['Web:InputWithoutLabelCheck', 'Web:S6840'].includes(i.rule))) {
 const file = issue.component.split(':').slice(1).join(':')
 const before = tree(execFileSync(gitExecutable,['show',`3aa551378:${file}`],{cwd:root,encoding:'utf8'}))
 const old = before.all.find(n => n.loc.start.line + before.offset === issue.line)
 assert(old, `native baseline ${file}:${issue.line}`)
 if(value(prop(old,'class'))?.split(' ').includes('hidden') || value(prop(old,'style'))?.includes('display: none')) continue
 const after = tree(fs.readFileSync(path.join(root,file),'utf8'))
 const matches = n => n.tag === old.tag && identity(n) === identity(old)
 const current = after.all.filter(matches)[before.all.filter(matches).indexOf(old)]
 assert(current, `native current ${file}:${issue.line}`)
 nativeFixtures.push({key:issue.key, file, baselineLine:issue.line, autocomplete:issue.rule === 'Web:S6840', spec:spec(current)})
}
async function main() {
 fs.mkdirSync(path.join(output,'screenshots'),{recursive:true})
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH})
 try {
 const page=await browser.newPage({viewport:{width:1280,height:900}})
 page.setDefaultTimeout(5000)
 await page.goto(process.env.FRONTEND_BASE || 'http://127.0.0.1:5197')
 await page.evaluate(async ({fixtures,nativeFixtures}) => {
  const vue=await import('/node_modules/.vite/deps/vue.js'), naive=await import('/node_modules/.vite/deps/naive-ui.js')
  document.body.innerHTML='<div id="sonar-review"></div><div id="native-review"></div><div id="host-indicator-review"></div>'
  const indicator=(await import('/src/components/HostAccessIndicator.vue')).default
  vue.createApp({render:()=>vue.h(indicator,{label:'Conexão de demonstração', detail:'SSH direto, host de demonstração', mode:'direct'})}).mount('#host-indicator-review')
  const style=document.createElement('style'); style.textContent='body{background:#fff;color:#222;margin:16px;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}article{border:1px solid #aaa;padding:12px;min-width:0}h2{font-size:13px;overflow-wrap:anywhere}label{display:block}';document.head.appendChild(style)
  const render=s=>typeof s==='string'?s:vue.h(naive[s.tag]||s.tag,s.props, s.tag.startsWith('N')?()=>s.children.map(render):s.children.map(render))
  vue.createApp({render:()=>vue.h('main',fixtures.map((f,i)=>vue.h('article',{'data-issue':f.key},[vue.h('h2',`${i+1}. ${f.file.split('/').pop()}:${f.line}`),render(f.spec)])))}).mount('#sonar-review')
   vue.createApp({render:()=>vue.h('main',nativeFixtures.map(f=>vue.h('article',{'data-native':f.key},[render(f.spec)])))}).mount('#native-review')
 },{fixtures,nativeFixtures})
 const nativeResults=[]
 for (const f of nativeFixtures) {
   const input=page.locator(`[data-native="${f.key}"]`).locator('input, select').first()
   if(f.autocomplete) assert.equal(await input.getAttribute('autocomplete'),'username')
   else assert((await input.getAttribute('aria-label'))?.length, `native name ${f.file}:${f.baselineLine}`)
   await input.focus()
   assert(await input.evaluate(el=>document.activeElement===el))
   nativeResults.push({key:f.key,file:f.file,baselineLine:f.baselineLine,named:!f.autocomplete,autocomplete:f.autocomplete?'username':null,focusable:true})
 }
 const indicator=page.getByRole('button',{name:'SSH direto, host de demonstração'})
 await indicator.focus()
 await page.keyboard.press('Escape')
 assert.equal(await indicator.getAttribute('aria-expanded'),'false')
 await page.keyboard.press('Enter')
 assert.equal(await indicator.getAttribute('aria-expanded'),'true')
 await page.keyboard.press('Escape')
 assert.equal(await indicator.getAttribute('aria-expanded'),'false')
 const results=[]
 for(const f of fixtures) {
   const box=page.locator(`[data-issue="${f.key}"]`)
   const role = {NInput:'textbox',NInputNumber:'textbox',NSelect:'textbox',NCheckbox:'checkbox',NSwitch:'switch'}[f.control]
   if (f.control === 'NSelect') { await box.locator('.n-base-selection').click(); await box.locator('input').focus() }
   const control=box.getByRole(role).first()
   await control.waitFor({state:'visible'}).catch(async error=>{throw new Error(`${f.file}:${f.line} ${await box.ariaSnapshot()} ${error.message}`)})
   const explicitLabels=[]
   for (const label of await box.locator('label[for]').all()) {
     const target=await label.getAttribute('for')
     assert(await label.evaluate(el=>el.control?.id === el.htmlFor), `native label association ${f.key}:${target}`)
     await label.click()
     assert(await label.evaluate(el=>el.control === document.activeElement), `label click focus ${f.key}:${target}`)
     explicitLabels.push(target)
   }
   const snapshot=await box.ariaSnapshot()
   assert(new RegExp(`${role} "[^"\\n]+"`).test(snapshot), `Missing name ${f.file}:${f.line}\n${snapshot}`)
   await control.focus()
   assert(await control.evaluate(el=>document.activeElement===el),`focus ${f.key}`)
   await page.keyboard.press('Escape')
   results.push({key:f.key,file:f.file,baselineLine:f.line,role,named:true,focusable:true,explicitLabels,snapshot})
 }
 await page.evaluate(()=>scrollTo(0,0))
 await page.screenshot({path:path.join(output,'screenshots/labels-desktop.png')})
 await page.setViewportSize({width:390,height:844})
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow')
 await page.evaluate(()=>scrollTo(0,0))
 await page.screenshot({path:path.join(output,'screenshots/labels-mobile.png')})
 fs.writeFileSync(path.join(output,'dom-label-evidence.json'),JSON.stringify({kind:'synthetic fixtures derived from current Vue markup; not full app workflow',count:results.length,results:results.map(publicIssue),nativeResults:nativeResults.map(publicIssue)},null,2)+'\n')
 console.log(`PASS ${results.length} labels + ${nativeResults.length} native controls: accessible name, focus, mobile no overflow`)
 } finally {await browser.close()}
}
if (process.argv[2] === '--workflow') {
 const allowed = ['platform-settings-playwright.cjs', 'snippets-page-playwright.cjs', 'audit-reconstruction-playwright.cjs', 'graphical-compositing-playwright.cjs', 'observability-resilience-playwright.cjs']
 const name = process.argv[3]
 assert(allowed.includes(name), 'Only synthetic existing workflows may be captured')
 const launch = chromium.launch.bind(chromium)
 chromium.launch = async options => {
   const browser = await launch({...options, executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH})
   let number = 0
   const captured = new WeakSet()
   async function capture(context) {
     if(captured.has(context)) return
     captured.add(context)
     for(const page of context.pages()) if(!page.isClosed() && page.url().startsWith('http://127.0.0.1:')) {
       if(name === 'platform-settings-playwright.cjs' && new URL(page.url()).pathname === '/platform/tenants') {
         await page.waitForTimeout(350)
       }
       await page.screenshot({path:path.join(output, 'screenshots', `${name.replace('-playwright.cjs','')}-${++number}.png`)})
     }
   }
   const newContext=browser.newContext.bind(browser), close=browser.close.bind(browser)
   browser.newContext=async options=>{const context=await newContext(options), end=context.close.bind(context); context.close=async()=>{try {await capture(context)} catch(error) {await close();throw error} finally {await end()}};return context}
   browser.close=async()=>{try {for(const context of browser.contexts()) await capture(context)} finally {await close()}}
   return browser
 }
 require(path.join(__dirname,name))
} else main().catch(error=>{console.error(error.message);process.exitCode=1})
