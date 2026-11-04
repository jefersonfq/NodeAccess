const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict')
const root=process.cwd();const ts=createRequire(root+'/package.json')('typescript')
const backend=fs.readFileSync(root+'/apps/backend/src/modules/terminal-highlights/terminal-highlight.service.ts','utf8')
const guard=backend.split('\n').find(line=>line.includes('test(rule.pattern)')).trim().slice(4,-3)
const rule={id:'probe',enabled:true,pattern:'(a|aa)+$',mode:'regex',caseSensitive:true,wholeWord:false,foreground:'red'}
const rejected=vm.runInNewContext(guard,{rule});assert.equal(rejected,false)
const src=fs.readFileSync(root+'/apps/frontend/src/terminal/terminal-highlighter.ts','utf8');const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const script=compiled+'\nconst r=exports.compileHighlightRules('+JSON.stringify([rule])+');exports.matchTerminalLine("a".repeat(60)+"!",r);'
const run=spawnSync(process.execPath,['-e',script],{timeout:1500,encoding:'utf8'});assert.equal(run.error?.code,'ETIMEDOUT')
const out={kind:'actual backend guard expression and transpiled frontend compileHighlightRules/matchTerminalLine; isolated process, not full browser session',guardRejected:rejected,pattern:rule.pattern,inputLength:61,childResult:run.error.code,deadlineMs:1500};console.log(JSON.stringify(out))
