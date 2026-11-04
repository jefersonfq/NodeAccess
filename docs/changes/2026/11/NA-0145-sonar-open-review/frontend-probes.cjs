const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process')
const path=require('node:path'),{isIP}=require('node:net')
const root=path.resolve(process.argv[2]||process.cwd()),req=createRequire(path.join(root,'package.json')),ts=req('typescript'),{withModifiers}=req('vue')
function fn(file,name){const s=fs.readFileSync(root+'/'+file,'utf8'),start=s.indexOf('function '+name+'(');if(start<0)throw Error('missing function');const end=s.indexOf('\n}',start);return s.slice(start,end+2)}
const audit='apps/frontend/src/views/admin/SessionAuditDetailView.vue',host='apps/frontend/src/views/HostsView.vue'
const source=[fn(host,'validateAsIPv6'),fn(audit,'normalizeEscapeGlyphs'),fn(audit,'stripTerminalControlSequences'),fn(audit,'isLikelyTerminalRedrawFrame')].join('\n')
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const context=vm.createContext({});vm.runInContext(js,context)
const ipv6=['2001:db8::1','1::2::3','abcd::def::123','2001:db8::1/129'].map(value=>({value,result:context.validateAsIPv6(value),nodeIsIP:isIP(value.split('/')[0])}))
const keys=['Tab','ArrowDown','PageDown','c'].map(key=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:key});Object.defineProperty(event,'ctrlKey',{value:key==='c'});withModifiers(()=>{},['prevent'])(event);return {key,ctrlKey:key==='c',defaultPrevented:event.defaultPrevented}})
const measurements=[]
for(const count of [1000,4000,12000]){
 const code=js+`\nconst input='\\x1bP'.repeat(${count});const started=performance.now();stripTerminalControlSequences(input);console.log(JSON.stringify({count:${count},milliseconds:performance.now()-started}));`
 const run=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:2500});measurements.push(run.status===0?JSON.parse(run.stdout):{count,status:'timeout_or_error',timedOut:run.error?.code==='ETIMEDOUT'})
}
const result={kind:'focused source extraction transpiled by TypeScript; real Vue withModifiers; no coverage credit',ipv6,keyboard:keys,dcsStripMeasurements:measurements};if(process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
