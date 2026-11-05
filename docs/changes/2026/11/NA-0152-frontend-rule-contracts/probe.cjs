// Source-extracted finite differential. No shell execution or transport claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const root=path.resolve(process.argv[2]||'.'), req=require('node:module').createRequire(path.join(root,'package.json')),ts=req('typescript')
const base='02e7521cbe69e72cb5c8c3f5f951dcdc6e1c5fec'
function tree(file,old){const src=old?execFileSync('/usr/bin/git',['show',`${base}:${file}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8');return ts.createSourceFile(file,src.replace(/^<script setup lang="ts">/,'').split('</script>')[0],ts.ScriptTarget.Latest,true)}
function nodes(t,p){const a=[];function visit(n){if(p(n))a.push(n);ts.forEachChild(n,visit)}visit(t);return a}
function parser(old){const t=tree('apps/frontend/src/services/terminal-path-autocomplete.service.ts',old),n=nodes(t,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='findLastCommandSegmentStart')[0];return vm.runInNewContext(ts.transpile(n.getText(t)+';findLastCommandSegmentStart'))}
function timestamp(old){const t=tree('apps/frontend/src/views/admin/HighAvailabilityView.vue',old),n=nodes(t,n=>ts.isTemplateExpression(n)&&n.head.text==='switchover-')[0];const text=n.getText(t).replace('new Date()','new Date(value)');return vm.runInNewContext(`value=>${text}`)}
const before=parser(true),after=parser(false);let parserChecks=0
const inputs=['', 'cd /var/lo', 'echo "中😀;||" && cd ', 'a;;;b|||c&&&d', 'a\\;b', "'unterminated;", 'a&&cd /var/']
let seed=819;const alphabet=['a',';','|','&','\\',"'",'"',' ','中','😀']
for(let i=0;i<4000;i++){let text='';for(let j=0;j<i%40;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=alphabet[seed%alphabet.length]}inputs.push(text)}
for(const text of inputs)for(let cursor=0;cursor<=text.length;cursor++){assert.equal(after(text.slice(0,cursor)),before(text.slice(0,cursor)));parserChecks++}
const oldTime=timestamp(true),newTime=timestamp(false);const dates=['2026-11-04T01:02:03.000Z','0001-01-01T00:00:00.999Z','-000001-01-01T00:00:00.001Z','+010000-12-31T23:59:59.123Z',-8640000000000000,8640000000000000]
for(let i=0;i<1000;i++)dates.push((i-500)*98765432101)
for(const d of dates){assert.equal(newTime(d),oldTime(d));assert.match(newTime(d),/^switchover-[+]?\d+T\d{6}Z$/)}
console.log(JSON.stringify({base,parserChecks,timestampChecks:dates.length,result:'passed',limits:'Finite source-extracted differential; no execution of user commands, no SSH/DB/API. Browser separately covers real Vue component.'},null,2))
