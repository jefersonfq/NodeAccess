// Source reviewed: ee436402db8bcce7fab4378d6ba28c1673b282b5. Read-only probes; temporary files only.
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const root=(process.env.REVIEW_ROOT || process.cwd())+'/';const results=[];
const guard=/\([^)]*[+*][^)]*\)[+*{]/;const repeated=/([+*])\1/;
const pattern='(a|aa)+$';assert.equal(guard.test(pattern)||repeated.test(pattern),false);
const t=performance.now();for(let i=0;i<40;i++)guard.test('('.repeat(53)+'*'.repeat(53)+'x'.repeat(54));results.push({probe:'detector 40 patterns of 160 chars',milliseconds:performance.now()-t});
const p=spawnSync(process.execPath,['-e',`new RegExp(${JSON.stringify(pattern)},'giu').exec('a'.repeat(60)+'!')`],{timeout:1500});assert.equal(p.error?.code,'ETIMEDOUT');results.push({probe:'accepted alternation regex on 61 chars',result:'ETIMEDOUT',deadlineMs:1500});
const normal=fs.readFileSync(root+'apps/backend/src/modules/session-audit/session-audit-normalizer.ts','utf8');
const multi=eval(normal.match(/const MULTI_PROMPT_LINE = (.*)/)[1]);const pager=eval(normal.match(/const PAGER_STATUS_LINE = (.*)/)[1]);
const start=performance.now();for(const s of ['a'.repeat(100000)+'!', ' '.repeat(100000), '['+'x'.repeat(100000), 'host$ host$'])multi.test(s);for(const s of ['line'+' '.repeat(100000)+'!', 'line '+'9'.repeat(100000)+'!', 'lines 1-2/3'])pager.test(s);results.push({probe:'prompt precondition and pager adverse 100k strings',milliseconds:performance.now()-start});
assert.equal(multi.test('host$ host$'),true);assert.equal(pager.test('lines 1-2/3'),true);
const intersect=(xs)=>xs.length?xs.reduce((cur,ids)=>cur.filter(id=>new Set(ids).has(id))):null;
assert.equal(intersect([]),null);assert.deepEqual(intersect([[1,2]]),[1,2]);assert.deepEqual(intersect([[1,2],[2,3]]),[2]);assert.deepEqual(intersect([[],[1]]),[]);results.push({probe:'guarded reduce 4 boundary cases',result:'PASS'});
const normalized='a'.repeat(100000)+'-';const n=performance.now();assert.equal(normalized.replace(/^-+|-+$/g,''),'a'.repeat(100000));results.push({probe:'diagnostic normalized slug trailing single separator',milliseconds:performance.now()-n});
fs.writeFileSync(require('node:path').join(process.env.PROBE_OUTPUT || require('node:os').tmpdir(),'regex-probes.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
