/* Reproduce demo flows first; replace manual illustrations only after every run passes. */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const output = '/tmp/nodeaccess-manual-review'
fs.mkdirSync(output,{recursive:true})
const commands = [
  ['tools/frontend/terminal-experience-playwright.cjs', {MANUAL_REVIEW:'1',UI_THEME:'light',REPORT_PATH:'/tmp/nodeaccess-manual-capture-review.json'}],
  ['tools/frontend/shared-viewer-geometry-playwright.cjs', {MANUAL_CAPTURE:'1'}],
  ['tools/frontend/terminal-experience-playwright.cjs', {TENANT_RETURN_REVIEW:'1',MANUAL_CAPTURE:'1',UI_THEME:'light',REPORT_PATH:'/tmp/nodeaccess-manual-capture-tenants.json'}],
]
for(const [script,extra] of commands){
 const result=spawnSync(process.execPath,[path.join(root,script)],{cwd:root,env:{...process.env,...extra},stdio:'inherit'})
 if(result.status!==0)process.exit(result.status||1)
}
const files={hosts:`${output}/hosts.png`,terminal:`${output}/terminal.png`,sftp:`${output}/sftp.png`,tenants:`${output}/tenants.png`,sharing:'/tmp/nodeaccess-shared-viewer-review/dark-controller.png'}
for(const file of Object.values(files)) if(!fs.existsSync(file)) throw new Error(`Missing capture: ${file}`)
for(const [id,file] of Object.entries(files)) fs.copyFileSync(file,path.join(root,`apps/frontend/public/manual-assets/${id}.png`))
console.log('Five verified demonstration captures updated. Review the content before advancing the editorial manifest.')
