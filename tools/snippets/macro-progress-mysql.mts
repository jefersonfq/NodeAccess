import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { SnippetService } from '../../apps/backend/src/modules/snippets/snippet.service.js'
import { SnippetExecutionEventService } from '../../apps/backend/src/modules/snippets/snippet-execution-event.service.js'
const name = 'nodeaccess-na0060-mysql-' + Date.now()
const docker = (...args: string[]): string => execFileSync('docker', args, {encoding:'utf8',stdio:['pipe','pipe','pipe']})
function sql(input: string): string {
  return execFileSync('docker',['exec','-i',name,'mysql','-uroot','--batch','--skip-column-names'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
}
function quote(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  return "'" + String(value).replaceAll('\\','\\\\').replaceAll("'","\\'") + "'"
}
async function main(): Promise<void> {
  docker('run','-d','--rm','--network','none','--name',name,'-e','MYSQL_ALLOW_EMPTY_PASSWORD=yes','mysql:8.4')
  try {
    let ready=false
    for(let i=0;i<60;i++){try{sql('SELECT 1;');ready=true;break}catch{await delay(1000)}}
    assert.ok(ready,'Disposable MySQL did not start')
    sql(`CREATE DATABASE macro_test;
USE macro_test;
CREATE TABLE snippets(id INT PRIMARY KEY,tenant_id INT);
CREATE TABLE snippet_execution_events(tenant_id INT,user_id INT,snippet_id INT,execution_id VARCHAR(64),source VARCHAR(24),status VARCHAR(40),host_id INT,session_id INT,metadata_json JSON, UNIQUE KEY(tenant_id,execution_id));
INSERT INTO snippets VALUES(11,3),(12,4);`)
    const db = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
        const query=strings.reduce((text,part,index)=>text+part+(index<values.length?quote(values[index]):''),'')
        return Number(sql('USE macro_test;'+query+'; SELECT ROW_COUNT();').split('\n').at(-1))
      },
    }
    const events = new SnippetExecutionEventService(db as never)
    const service = new SnippetService(db as never,{requireFeature:async()=>{}} as never)
    const event={tenantId:3,userId:7,snippetId:11,executionId:'fixture-run',source:'TERMINAL' as const,status:'SENT' as const,metadata:{transport:'fixture'}}
    await events.record(event)
    const outcome={executionId:'fixture-run',status:'completed' as const,step:2,total:2}
    assert.equal(await service.recordOutcome(7,3,11,outcome),true)
    await events.record({...event,metadata:{late:true}})
    const metadata=JSON.parse(sql("USE macro_test;SELECT metadata_json FROM snippet_execution_events WHERE tenant_id=3;"))
    assert.equal(metadata.macro.status,'completed')
    assert.equal(metadata.transport,'fixture')
    assert.equal(metadata.late,true)
    assert.equal(await service.recordOutcome(99,3,11,{...outcome,status:'failed'}),false)
    assert.equal(await service.recordOutcome(7,4,11,{...outcome,status:'failed'}),false)
    assert.equal(await service.recordOutcome(7,3,12,{...outcome,status:'failed'}),false)
    assert.equal(await service.recordOutcome(7,3,11,{...outcome,executionId:'missing'}),false)
    assert.equal(sql("USE macro_test; SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.macro.status')) FROM snippet_execution_events;"),'completed')
    console.log(JSON.stringify({ok:true,disposableMySQL:true,metadataMerge:true,tenantUserSnippetIsolation:true,missingEvent:true}))
  } finally { docker('rm','-f',name) }
}
main().catch(error=>{console.error(error);process.exitCode=1})
