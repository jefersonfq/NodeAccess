/** Synthetic command/output pairs. Nothing in this corpus is executed on a host. */
export interface OperationalCommand { command: string; output: string; input?: string }
export interface OperationalSession { id: number; name: string; expected: OperationalCommand[]; content: string }
const linux: OperationalCommand[] = [
  ['pwd','/srv/lab'],['whoami','audit'],['id','uid=1000(audit) gid=1000(audit)'],['uname -a','Linux lab 6.8 x86_64 GNU/Linux'],
  ['ls -lha /var/log','total 24\ndrwxr-xr-x 2 root adm 4096 set 29 19:00 app'],['df -h','Filesystem Size Used Avail Use% Mounted on\n/dev/vda1 40G 12G 28G 30% /'],
  ['df -i','/dev/vda1 2621440 84520 2536920 4% /'],['du -sh /srv/lab','24M /srv/lab'],['free -m','Mem: 8192 2048 6144'],
  ['ps -eo pid,comm,%cpu --sort=-%cpu','PID COMMAND %CPU\n412 postgres 12.3'],['systemctl status sshd --no-pager','Active: active (running)'],
  ['systemctl status missing.service --no-pager','Unit missing.service could not be found.'],['journalctl -u app -n 5 --no-pager','app: conexão estabelecida\napp: ERROR upstream timeout'],
  ['ip -br addr','eth0 UP 192.0.2.10/24'],['ip route','default via 192.0.2.1 dev eth0'],['ss -ltnp','LISTEN 0 128 127.0.0.1:5432'],
  ['ping -c 2 192.0.2.1','2 packets transmitted, 2 received, 0% packet loss'],['curl --max-time 2 https://example.invalid','curl: (28) Connection timed out'],
  ['dig +short example.test','192.0.2.20'],['getent hosts lab.example.test','192.0.2.10 lab.example.test'],
  ['find /srv/lab -type f -name "*.log"','/srv/lab/app.log'],["grep -nE 'ERROR|WARN' /srv/lab/app.log",'7:ERROR timeout\n9:WARN retry'],
  ["awk '{sum += $2} END {print sum}' /srv/lab/report.txt",'42'],["sed -n '1,3p' /srv/lab/report.txt",'alpha 12\nbeta 30'],
  ["cut -d, -f2 /srv/lab/data.csv | sort | uniq -c",'2 Natal\n1 São Paulo'],['wc -l /srv/lab/app.log','120 /srv/lab/app.log'],
  ['stat /srv/lab/app.log','Size: 4096\nAccess: (0640/-rw-r-----)'],['readlink -f /srv/lab/current','/srv/lab/releases/v2'],
  ['sha256sum /srv/lab/report.txt','d7a8fbb307d7809469ca9abcb0082e4f8e5651e46d3cdb762d02d0bf37c9e592 lab-report'],
  ['tar -tzf /srv/lab/backup.tgz','data/\ndata/report.csv'],['gzip -t /srv/lab/invalid.gz','gzip: invalid compressed data--crc error'],
  ['docker ps --format "{{.Names}} {{.Status}}"','lab-api Up 2 hours'],['docker logs --tail 3 lab-api','ready\nrequest complete'],
  ['kubectl get pods -n lab','api-0 1/1 Running 0 2h'],['kubectl logs deployment/api -n lab --tail=2','started\nready'],
  ['git status --short',' M README.md'],['git log -1 --oneline','a1b2c3d teste sintético'],['cat /root/denied','cat: /root/denied: Permission denied'],
  ['nonexistent-command','bash: nonexistent-command: command not found'],['printf "ação 漢字 🚀\\n"','ação 漢字 🚀'],
].map(([command,output])=>({command:command!,output:output!}))
const shell: OperationalCommand[] = [
  ['for n in 1 2 3; do printf "item-%s\\n" "$n"; done','item-1\nitem-2\nitem-3'],
  ['if test -r /srv/lab/report.txt; then echo readable; else echo denied; fi','readable'],
  ["while IFS= read -r line; do printf '%s\\n' \"$line\"; done < /srv/lab/report.txt",'alpha 12\nbeta 30'],
  ['value="São Paulo"; printf "<%s>\\n" "$value"','<São Paulo>'],
  ['printf "%s\\n" "$(printf nested)"','nested'],
  ["printf '%s\\n' 'literal ; && | $HOME'",'literal ; && | $HOME'],
  ['false; printf "exit=%s\\n" "$?"','exit=1'],['true && echo success || echo failure','success'],
  ["bash -c 'echo warning >&2; exit 2'",'warning'],['timeout 1 sleep 5; echo $?','124'],
  ['set -o pipefail; false | cat; echo $?','1'],['printf "a\\nb\\n" | while read x; do echo "$x"; done','a\nb'],
  ['function greet() { printf "Olá %s\\n" "$1"; }; greet Natal','Olá Natal'],
  ['cat <<\'SQL\'\nSELECT \'ação\';\nSQL',"SELECT 'ação';"],
  ['for n in 1 2; do\n  printf "etapa-%s\\n" "$n"\ndone','etapa-1\netapa-2'],
  ['printf "a\\nb\\n" \\\n  | grep b','b'],
  ['printf "100%%\\n"','100%'],['printf "\\033[31mERROR\\033[0m\\n"','\x1b[31mERROR\x1b[0m'],
  ['printf "progresso"','10%\r100%\x1b[K'],
  ["printf '%s\\n' '<img src=x onerror=alert(1)>'",'<img src=x onerror=alert(1)>'],
].map(([command,output])=>({command:command!,output:output!}))
const sql: OperationalCommand[] = [
  {command:'mysql reporting',output:'Welcome to the MySQL monitor.'},
  ...[
    ['SELECT 1;','1'],['SHOW DATABASES;','reporting'],['USE reporting;','Database changed'],['SHOW TABLES;','reports'],
    ['DESCRIBE reports;','id bigint\ncity varchar(100)'],["SELECT 'a;b', 'São Paulo', '漢字';",'a;b São Paulo 漢字'],
    ['SELECT COUNT(*) FROM reports;','42'],['SELECT city, SUM(total) FROM reports GROUP BY city ORDER BY city;','Natal 120\nSão Paulo 240'],
    ['SELECT * FROM reports WHERE id = 99999;','Empty set (0.00 sec)'],
    ['SELECT missing_column FROM reports;',"ERROR 1054 (42S22): Unknown column 'missing_column' in 'field list'"],
    ['SELECT * FROM missing_table;',"ERROR 1146 (42S02): Table 'reporting.missing_table' doesn't exist"],
    ['EXPLAIN SELECT * FROM reports WHERE id = 1;','type: const\nkey: PRIMARY\nrows: 1'],
    ["SELECT JSON_EXTRACT('{\"city\":\"Natal\"}', '$.city');",'"Natal"'],
    ["SELECT DATE_FORMAT(created_at, '%Y-%m-%d'), COUNT(*)\nFROM reports\nWHERE created_at >= '2026-09-01 00:00:00'\nGROUP BY 1 ORDER BY 1;",'2026-09-01 42'],
    ['WITH totals AS (SELECT city, SUM(total) AS amount FROM reports GROUP BY city) SELECT * FROM totals;','Natal 120'],
    ['SELECT id, ROW_NUMBER() OVER (PARTITION BY city ORDER BY created_at) FROM reports;','1 1\n2 2'],
    ['START TRANSACTION;','Query OK, 0 rows affected'],['SAVEPOINT before_report;','Query OK, 0 rows affected'],
    ['ROLLBACK TO SAVEPOINT before_report;','Query OK, 0 rows affected'],['ROLLBACK;','Query OK, 0 rows affected'],
    ['SHOW INDEX FROM reports;','PRIMARY id\nidx_city city'],['SHOW PROCESSLIST;','1 lab localhost reporting Query 0 executing'],
    ['SELECT SLEEP(30);','ERROR 1317 (70100): Query execution was interrupted'],['status','Uptime: 1234\nThreads: 1'],
  ].map(([command,output])=>({command:command!,output:output!})),
  {command:'SELECT 101;',input:'SELECT 100;\x1b[D\x7f1\x1b[F\r',output:'101'},
  {command:'quit',output:'Bye'},
]
const clients: OperationalCommand[] = [
  ['psql -d reporting -c "SELECT version();"','PostgreSQL 16.4'],
  ['psql -d reporting -c "SELECT current_database(), current_user;"','reporting | lab'],
  ["psql -d reporting -c \"SELECT 'ação' AS cidade;\"",'ação'],
  ['psql -d reporting -c "EXPLAIN SELECT * FROM reports WHERE id=1;"','Index Scan using reports_pkey on reports'],
  ['psql -d reporting -c "SELECT missing FROM reports;"','ERROR: column "missing" does not exist'],
  ['psql -d reporting -c "SELECT pg_sleep(30);"','ERROR: canceling statement due to statement timeout'],
  ['sqlite3 /srv/lab/reports.db "SELECT COUNT(*) FROM reports;"','42'],
  ['sqlite3 /srv/lab/reports.db "PRAGMA table_info(reports);"','0|id|INTEGER|0||1'],
  ['sqlite3 /srv/lab/reports.db "SELECT * FROM missing;"','Error: no such table: missing'],
  ['redis-cli PING','PONG'],['redis-cli --scan --pattern "lab:*"','lab:report:1'],
  ['mongosh --quiet --eval "db.reports.countDocuments({})"','42'],
  ['sqlcmd -S lab -Q "SELECT @@VERSION"','Microsoft SQL Server 2022'],
  ['mysql -e "SELECT 1" --host=192.0.2.99 --connect-timeout=1',"ERROR 2003 (HY000): Can't connect to MySQL server"],
  ['bash /srv/lab/backup.sh --dry-run','[DRY RUN] reports\nbackup validation complete'],
].map(([command,output])=>({command:command!,output:output!}))

export function operationalCorpus(): OperationalSession[] {
  const postgres: OperationalCommand[] = [
    {command:'psql reporting',output:'psql (16.4)'},
    {command:'\\dt',output:'public | reports | table | lab'},
    {command:'\\d reports',output:'id | bigint\ncity | text'},
    {command:'\\timing on',output:'Timing is on.'},
    {command:"SELECT city, COUNT(*)\nFROM reports\nWHERE city IN ('Natal', 'São Paulo')\nGROUP BY city;",output:'Natal | 12\nSão Paulo | 30\n(2 rows)'},
    {command:'SELECT missing FROM reports;',output:'ERROR: column "missing" does not exist'},
    {command:'SELECT pg_sleep(30);',output:'ERROR: canceling statement due to user request'},
    {command:'\\q',output:''},
  ]
  const groups = [{id:4177,name:'Linux',expected:linux},{id:4178,name:'Shell scripts',expected:shell},{id:4179,name:'MySQL interativo',expected:sql},{id:4180,name:'Clientes de banco',expected:clients},
    {id:4181,name:'Carga Linux 600',expected:Array.from({length:15},()=>linux).flat()}, {id:4182,name:'PostgreSQL interativo',expected:postgres}]
  return groups.map(group=>{
    const records: object[] = []
    const push=(type:string,data='',extra:object={})=>records.push({seq:records.length+1,ts:new Date(Date.parse('2026-09-29T12:00:00Z')+records.length*20).toISOString(),type,payload:{data,...extra}})
    push('session_started');push('resize','',{cols:120,rows:30});push('stdout','[audit@lab ~]$ ')
    group.expected.forEach((item,index)=>{
      const input=item.input??(item.command.includes('\n')?'\x1b[200~'+item.command+'\x1b[201~\r':item.command+'\r')
      // Deterministic fragmentation across escape sequences, quotes and Unicode.
      const chunkSize=group.id===4181?input.length:7
      for(let i=0;i<input.length;i+=chunkSize)push('stdin',input.slice(i,i+chunkSize),{actorUserId:index%2+1})
      const prompt=group.id===4179&&item.command!=='quit'?'mysql> ':group.id===4182&&item.command!=='\\q'?'reporting=> ':'[audit@lab ~]$ '
      const output=item.command.replaceAll('\n','\r\n')+'\r\n'+item.output.replace(/(?<!\r)\n/g,'\r\n')+'\r\n'+prompt
      for(let i=0;i<output.length;i+=group.id===4181?output.length:31)push('stdout',output.slice(i,i+(group.id===4181?output.length:31)))
    })
    push('session_ended')
    return {...group,content:records.map(r=>JSON.stringify(r)).join('\n')}
  })
}
