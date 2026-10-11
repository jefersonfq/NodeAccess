import {writeFileSync} from 'node:fs'
import {buildCommandTimeline} from '../../apps/backend/src/modules/session-audit/session-audit-normalizer.js'
import type {SessionAuditPreviewEvent} from '@nodeaccess/shared'
const events:SessionAuditPreviewEvent[]=[]
const emit=(type:SessionAuditPreviewEvent['type'],text:string)=>events.push({seq:events.length+1,timestamp:new Date(Date.UTC(2026,8,28,12,0,events.length)).toISOString(),type,text,actorUserId:type==='stdin'?1:null,bytes:Buffer.byteLength(text),cols:null,rows:null})
emit('session_started','')
emit('stdout','[audit@lab ~]$ ')
for(const cmd of ['pwd','whoami','date','hostname','mysql reports']) {
 emit('stdin',cmd+'\r');emit('stdout',cmd+'\r\n'+(cmd.startsWith('mysql')?'mysql> ':'ok\r\n[audit@lab ~]$ '))
}
const sql="SELECT 'relatório  mensal' AS label,\n       customer_id, SUM(duration) AS total\nFROM reports\nWHERE note = '"+'texto'.repeat(90)+"'\nGROUP BY customer_id;"
emit('stdin','\x1b[200~'+sql+'\x1b[201~\r')
emit('stdout','1 row in set\r\nmysql> ')
emit('stdin','SELECT 1;\x1b[A\r')
emit('stdout','unresolved history result\r\nmysql> ')
emit('session_ended','')
writeFileSync('/tmp/nodeaccess-audit-synthetic-review.json',JSON.stringify({events,commands:buildCommandTimeline(events)}),{mode:0o600})
