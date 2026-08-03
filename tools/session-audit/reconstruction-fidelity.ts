#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { buildCommandTimeline, cleanCommandOutput, stripAnsi } from '../../apps/backend/src/modules/session-audit/session-audit-normalizer.js'
import type { SessionAuditCommand, SessionAuditPreviewEvent } from '../../packages/shared/src/schemas/session-audit.schema.js'

type ScenarioResult = {
  name: string
  ok: boolean
  expectedCommands: number
  actualCommands: number
  exactCommandMatches: number
  outputMatches: number
  outputExclusionMatches: number
  interactiveCommands: number
  fidelityScore: number
  durationMs: number
  findings: string[]
  samples: Array<{
    index: number
    expected: string
    actual: string | null
    outputOk: boolean
    outputExclusionsOk: boolean
    confidence: SessionAuditCommand['confidence'] | null
  }>
}

type CommandExpectation = {
  command: string
  outputIncludes?: string | string[]
  outputExcludes?: string | string[]
  interactive?: boolean
  allowOutputMismatch?: boolean
}

const TS_BASE = Date.parse('2026-01-01T00:00:00.000Z')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-session-audit-reconstruction-fidelity.json'
const RANDOM_COUNTS = (process.env.RANDOM_COUNTS || '100,200,300')
  .split(',')
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isFinite(item) && item > 0)

function ts(offsetMs: number) {
  return new Date(TS_BASE + offsetMs).toISOString()
}

function event(seq: number, type: SessionAuditPreviewEvent['type'], text: string | null, offsetMs: number, extra: Partial<SessionAuditPreviewEvent> = {}): SessionAuditPreviewEvent {
  return {
    seq,
    timestamp: ts(offsetMs),
    type,
    text,
    actorUserId: null,
    bytes: text ? Buffer.byteLength(text) : null,
    cols: null,
    rows: null,
    ...extra,
  }
}

function prompt(i: number) {
  const cwd = i % 2 === 0 ? '~' : '/var/log'
  return `[suporte@nodeaccess ${cwd}]$ `
}

function simpleCommand(i: number) {
  return `printf 'NA-CMD-${String(i).padStart(3, '0')}'; echo done-${i}`
}

function simpleOutput(i: number) {
  return `NA-CMD-${String(i).padStart(3, '0')}done-${i}`
}

function bulkEvents(count: number): { events: SessionAuditPreviewEvent[]; expected: CommandExpectation[] } {
  const events: SessionAuditPreviewEvent[] = []
  const expected: CommandExpectation[] = []
  let seq = 1
  let offset = 0
  events.push(event(seq++, 'session_started', null, offset))
  events.push(event(seq++, 'stdout', prompt(0), offset += 2))

  for (let i = 1; i <= count; i += 1) {
    const command = simpleCommand(i)
    expected.push({ command, outputIncludes: simpleOutput(i) })
    events.push(event(seq++, 'stdin', `${command}\r`, offset += 3))
    if (i % 7 === 0) {
      events.push(event(seq++, 'resize', null, offset += 1, { cols: 120 + (i % 40), rows: 35 }))
    }
    if (i % 11 === 0) {
      events.push(event(seq++, 'stdout', `\x1b[32m${command}\x1b[0m\r\n${simpleOutput(i)}\r\n${prompt(i)}`, offset += 4))
    } else {
      events.push(event(seq++, 'stdout', `${command}\r\n${simpleOutput(i)}\r\n${prompt(i)}`, offset += 4))
    }
  }

  events.push(event(seq++, 'session_ended', null, offset += 5))
  return { events, expected }
}

function combinedOutputEvents(count: number): { events: SessionAuditPreviewEvent[]; expected: CommandExpectation[] } {
  const events: SessionAuditPreviewEvent[] = []
  const expected: CommandExpectation[] = []
  let seq = 1
  let offset = 0
  events.push(event(seq++, 'session_started', null, offset))
  events.push(event(seq++, 'stdout', prompt(0), offset += 2))

  const stdoutParts: string[] = []
  for (let i = 1; i <= count; i += 1) {
    const command = `echo combined-${i}`
    expected.push({ command, outputIncludes: `combined-${i}` })
    events.push(event(seq++, 'stdin', `${command}\r`, offset += 1))
    stdoutParts.push(`${command}\r\ncombined-${i}\r\n${prompt(i)}`)
  }
  events.push(event(seq++, 'stdout', stdoutParts.join(''), offset += 5))
  events.push(event(seq++, 'session_ended', null, offset += 5))
  return { events, expected }
}

function editorAndControlEvents(): { events: SessionAuditPreviewEvent[]; expected: CommandExpectation[] } {
  const events: SessionAuditPreviewEvent[] = []
  let seq = 1
  let offset = 0
  events.push(event(seq++, 'session_started', null, offset))
  events.push(event(seq++, 'stdout', prompt(0), offset += 2))
  events.push(event(seq++, 'stdin', 'vim dnf.l\t\r', offset += 3))
  events.push(event(seq++, 'stdout', 'vim dnf.log\r\n\x1b[?1049h\x1b[H"dnf.log" 120L, 4096C\r\n\x1b[?1049l\r\n[suporte@nodeaccess /var/log]$ ', offset += 4))
  events.push(event(seq++, 'stdin', 'ecoh\b\bho fixed\r', offset += 3))
  events.push(event(seq++, 'stdout', 'echo fixed\r\nfixed\r\n[suporte@nodeaccess /var/log]$ ', offset += 4))
  events.push(event(seq++, 'stdin', 'less /var/log/messages\r', offset += 3))
  events.push(event(seq++, 'stdout', 'less /var/log/messages\r\nline1\nline2\nlines 1-21/21 (END)', offset += 4))
  events.push(event(seq++, 'stdin', 'q', offset += 3))
  events.push(event(seq++, 'stdout', '\x1b>[suporte@nodeaccess /var/log]$ ', offset += 4))
  events.push(event(seq++, 'session_ended', null, offset += 5))
  return {
    events,
    expected: [
      { command: 'vim dnf.log', outputIncludes: 'Saída interativa contínua detectada', outputExcludes: ['2026-07-06T16:18:14-0300 DEBUG'], interactive: true },
      { command: 'echo fixed', outputIncludes: 'fixed' },
      { command: 'less /var/log/messages', outputIncludes: 'line1', outputExcludes: 'lines 1-21/21 (END)', interactive: true },
    ],
  }
}

function tuiExitCarryoverEvents(): { events: SessionAuditPreviewEvent[]; expected: CommandExpectation[] } {
  const events: SessionAuditPreviewEvent[] = []
  let seq = 1
  let offset = 0
  events.push(event(seq++, 'session_started', null, offset))
  events.push(event(seq++, 'stdout', prompt(0), offset += 2))
  events.push(event(seq++, 'stdin', 'htop\r', offset += 3))
  events.push(event(seq++, 'stdout', '\x1b[?1049h\x1b[Hhtop screen redraw\x1b(B', offset += 4))
  events.push(event(seq++, 'stdout', `\x1b[?1049l${prompt(1)}`, offset += 4))
  events.push(event(seq++, 'stdin', 'q', offset += 3))
  for (const char of 'ifocnfig') {
    events.push(event(seq++, 'stdin', char, offset += 1))
    events.push(event(seq++, 'stdout', char, offset += 1))
  }
  events.push(event(seq++, 'stdin', '\r', offset += 1))
  events.push(event(seq++, 'stdout', `\r\n-bash: ifocnfig: comando não encontrado\r\n${prompt(2)}`, offset += 4))
  events.push(event(seq++, 'stdin', 'ifconfig\r', offset += 3))
  events.push(event(seq++, 'stdout', `ifconfig\r\neth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>\r\n${prompt(3)}`, offset += 4))
  events.push(event(seq++, 'session_ended', null, offset += 5))
  return {
    events,
    expected: [
      { command: 'htop', outputIncludes: 'Saída interativa contínua detectada', outputExcludes: ['screen redraw', '(B'], interactive: true },
      { command: 'ifocnfig', outputIncludes: 'ifocnfig: comando não encontrado' },
      { command: 'ifconfig', outputIncludes: 'eth0' },
    ],
  }
}

function shellFidelityEdgeEvents(): { events: SessionAuditPreviewEvent[]; expected: CommandExpectation[] } {
  const events: SessionAuditPreviewEvent[] = []
  let seq = 1
  let offset = 0
  events.push(event(seq++, 'session_started', null, offset))
  events.push(event(seq++, 'stdout', '[suporte@nodeaccess ~]$ ', offset += 2))

  events.push(event(seq++, 'stdin', 'cd /va\tr/log\r', offset += 2))
  events.push(event(seq++, 'stdout', '\r\n[suporte@nodeaccess /var/log]$ ', offset += 3))

  events.push(event(seq++, 'stdin', 'sudo systemctl status nginx\r', offset += 2))
  events.push(event(seq++, 'stdout', '[sudo] password for suporte: ', offset += 2))
  events.push(event(seq++, 'stdin', '{{secret:sudo-suporte}}\r', offset += 2))
  events.push(event(seq++, 'stdout', [
    '\r\n● nginx.service - nginx',
    '   Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled)',
    '   Active: active (running) since Sat 2026-07-18 10:00:00 -03',
    '[suporte@nodeaccess /var/log]$ ',
  ].join('\n'), offset += 3))

  events.push(event(seq++, 'stdin', 'printf \"[root@fake ~]# not-a-prompt\\nreal-line\\n\"\r', offset += 2))
  events.push(event(seq++, 'stdout', 'printf "[root@fake ~]# not-a-prompt\\nreal-line\\n"\r\n[root@fake ~]# not-a-prompt\nreal-line\n[suporte@nodeaccess /var/log]$ ', offset += 3))

  events.push(event(seq++, 'stdin', 'echo one && echo two\r', offset += 2))
  events.push(event(seq++, 'stdout', 'echo one && echo two\r\none\ntwo\n[suporte@nodeaccess /var/log]$ ', offset += 3))

  events.push(event(seq++, 'stdin', 'tail -f /var/log/messages', offset += 2))
  events.push(event(seq++, 'stdin', '\x03', offset += 1))
  events.push(event(seq++, 'stdout', '^C\r\n[suporte@nodeaccess /var/log]$ ', offset += 2))

  events.push(event(seq++, 'stdin', 'cat /tmp/split-output\r', offset += 2))
  events.push(event(seq++, 'stdout', 'cat /tmp/split-output\r\nline-a\n', offset += 1))
  events.push(event(seq++, 'stdout', 'line-b\nline-c\n[suporte@nodeaccess /var/log]$ ', offset += 2))

  events.push(event(seq++, 'session_ended', null, offset += 5))
  return {
    events,
    expected: [
      { command: 'cd /var/log' },
      { command: 'sudo systemctl status nginx', outputIncludes: ['password for suporte', 'Active: active (running)'], outputExcludes: '{{secret:' },
      { command: 'printf "[root@fake ~]# not-a-prompt\\nreal-line\\n"', outputIncludes: ['[root@fake ~]# not-a-prompt', 'real-line'] },
      { command: 'echo one && echo two', outputIncludes: ['one', 'two'] },
      { command: 'cat /tmp/split-output', outputIncludes: ['line-a', 'line-b', 'line-c'] },
    ],
  }
}

function comprehensiveAuditPlanEvents(): { events: SessionAuditPreviewEvent[]; expected: CommandExpectation[] } {
  const events: SessionAuditPreviewEvent[] = []
  const expected: CommandExpectation[] = []
  const state = { seq: 1, offset: 0 }
  const shellPrompt = '[suporte@nodeaccess ~]$ '
  const tmpPrompt = '[suporte@nodeaccess /tmp]$ '
  const rootPrompt = '[root@nodeaccess /]# '
  const nodePrompt = 'NODEACCESS> '

  events.push(event(state.seq++, 'session_started', null, state.offset))
  events.push(event(state.seq++, 'stdout', [
    'Last login: Sat Jul 18 16:40:00 2026 from 10.0.0.15',
    'Bem-vindo ao NodeAccess audit target',
    shellPrompt,
  ].join('\r\n'), state.offset += 2))

  const add = (command: string, output: string, options: { split?: boolean; echo?: boolean; expectedCommand?: string; includes?: string | string[]; excludes?: string | string[]; interactive?: boolean } = {}) => {
    typeCommandEvents(events, `${command}\r`, output, state, { split: options.split, echo: options.echo })
    expected.push({
      command: options.expectedCommand ?? command,
      outputIncludes: options.includes,
      outputExcludes: options.excludes,
      interactive: options.interactive,
    })
  }

  add('pwd', `pwd\r\n/home/suporte\r\n${shellPrompt}`, { includes: '/home/suporte' })
  add('whoami', `whoami\r\nsuporte\r\n${shellPrompt}`, { includes: 'suporte' })
  add('id', `id\r\nuid=1000(suporte) gid=1000(suporte) groups=1000(suporte),10(wheel)\r\n${shellPrompt}`, { includes: 'uid=1000' })
  add('hostnamectl', `hostnamectl\r\n Static hostname: nodeaccess-test\r\n Operating System: Rocky Linux 8.10\r\n${shellPrompt}`, { includes: ['nodeaccess-test', 'Rocky Linux'] })
  add('uname -a', `uname -a\r\nLinux nodeaccess-test 5.15.0 x86_64 GNU/Linux\r\n${shellPrompt}`, { includes: 'GNU/Linux' })
  add('cat /etc/os-release', `cat /etc/os-release\r\nNAME="Rocky Linux"\nVERSION="8.10"\r\n${shellPrompt}`, { includes: 'Rocky Linux' })
  add('echo $SHELL', `echo $SHELL\r\n/bin/bash\r\n${shellPrompt}`, { includes: '/bin/bash' })
  add('env', `env\r\nSHELL=/bin/bash\nTERM=xterm-256color\nLANG=pt_BR.UTF-8\r\n${shellPrompt}`, { includes: ['TERM=xterm-256color', 'LANG=pt_BR.UTF-8'] })

  add('ls -lah', [
    'ls -lah',
    'total 20K',
    'drwx------  4 suporte suporte 4.0K jul 18 16:40 .',
    '-rw-r--r--  1 suporte suporte   14 jul 18 16:40 teste.txt',
    shellPrompt,
  ].join('\r\n'), { includes: ['total 20K', 'teste.txt'] })
  add('find /tmp -maxdepth 2', `find /tmp -maxdepth 2\r\n/tmp\n/tmp/nodeaccess\n/tmp/nodeaccess/teste.txt\r\n${shellPrompt}`, { includes: '/tmp/nodeaccess/teste.txt' })

  add('touch teste.txt', `touch teste.txt\r\n${shellPrompt}`)
  add('echo "Primeira linha" > teste.txt', `echo "Primeira linha" > teste.txt\r\n${shellPrompt}`)
  add('echo "Segunda linha" >> teste.txt', `echo "Segunda linha" >> teste.txt\r\n${shellPrompt}`)
  add('cat teste.txt', `cat teste.txt\r\nPrimeira linha\nSegunda linha\r\n${shellPrompt}`, { includes: ['Primeira linha', 'Segunda linha'] })
  add('nl teste.txt', `nl teste.txt\r\n     1\tPrimeira linha\n     2\tSegunda linha\r\n${shellPrompt}`, { includes: '1 Primeira linha' })
  add('cp teste.txt copia.txt', `cp teste.txt copia.txt\r\n${shellPrompt}`)
  add('mv copia.txt novo_nome.txt', `mv copia.txt novo_nome.txt\r\n${shellPrompt}`)
  add('chmod 600 novo_nome.txt', `chmod 600 novo_nome.txt\r\n${shellPrompt}`)
  add('rm novo_nome.txt', `rm novo_nome.txt\r\n${shellPrompt}`)

  add('mkdir -p a/b/c/d', `mkdir -p a/b/c/d\r\n${shellPrompt}`)
  add('tree a', `tree a\r\na\n└── b\n    └── c\n        └── d\r\n${shellPrompt}`, { includes: ['└── b', 'd'] })
  add('rm -rf a', `rm -rf a\r\n${shellPrompt}`)
  add('cd /tmp', `cd /tmp\r\n\x1b]0;suporte@nodeaccess:/tmp\x07${tmpPrompt}`, { expectedCommand: 'cd /tmp' })

  add('ls inexistente 2> erro.log', `ls inexistente 2> erro.log\r\n${tmpPrompt}`)
  add('ls /tmp inexistente > tudo.log 2>&1', `ls /tmp inexistente > tudo.log 2>&1\r\n${tmpPrompt}`)
  add('cat /etc/passwd | grep root', `cat /etc/passwd | grep root\r\nroot:x:0:0:root:/root:/bin/bash\r\n${tmpPrompt}`, { includes: 'root:x:0:0' })
  add("ps aux | grep ssh | grep -v grep | awk '{print $2}'", `ps aux | grep ssh | grep -v grep | awk '{print $2}'\r\n1234\n2345\r\n${tmpPrompt}`, { includes: ['1234', '2345'] })

  add('top -b -n1', `top -b -n1\r\ntop - 16:42:00 up 10 days\nTasks: 120 total\n%Cpu(s):  1.0 us\nPID USER COMMAND\n1 root systemd\r\n${tmpPrompt}`, { includes: ['Tasks: 120', 'systemd'] })
  add('sleep 100 &', `sleep 100 &\r\n[1] 4567\r\n${tmpPrompt}`, { includes: '[1] 4567' })
  add('kill %1', `kill %1\r\n${tmpPrompt}`)

  add('df -h', `df -h\r\nFilesystem Size Used Avail Use% Mounted on\n/dev/sda1 40G 12G 28G 31% /\r\n${tmpPrompt}`, { includes: '/dev/sda1' })
  add('ip a', `ip a\r\n2: eth0: <BROADCAST,MULTICAST,UP>\n    inet 10.0.0.20/24\r\n${tmpPrompt}`, { includes: '10.0.0.20/24' })
  add('ss -tulpn', `ss -tulpn\r\nNetid State Local Address:Port Process\ntcp LISTEN 0.0.0.0:22 users:(("sshd",pid=900,fd=3))\r\n${tmpPrompt}`, { includes: '0.0.0.0:22' })
  add('ping -c 4 8.8.8.8', `ping -c 4 8.8.8.8\r\n64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=12.3 ms\n--- 8.8.8.8 ping statistics ---\n4 packets transmitted, 4 received\r\n${tmpPrompt}`, { includes: '4 packets transmitted' })
  add('curl https://example.com', `curl https://example.com\r\n<!doctype html><title>Example Domain</title>\r\n${tmpPrompt}`, { includes: 'Example Domain' })
  add('dig google.com', `dig google.com\r\n;; ANSWER SECTION:\ngoogle.com. 300 IN A 142.250.0.1\r\n${tmpPrompt}`, { includes: 'ANSWER SECTION' })

  add('systemctl status sshd', `systemctl status sshd\r\n● sshd.service - OpenSSH server daemon\n   Active: active (running)\r\n${tmpPrompt}`, { includes: 'Active: active (running)' })
  add('journalctl -u sshd', `journalctl -u sshd\r\nJul 18 nodeaccess sshd[900]: Server listening on 0.0.0.0 port 22.\r\n${tmpPrompt}`, { includes: 'Server listening' })
  add('tail -100 /var/log/secure', `tail -100 /var/log/secure\r\nJul 18 sshd[123]: Accepted password for suporte\r\n${tmpPrompt}`, { includes: 'Accepted password' })
  add('find /root', `find /root\r\nfind: '/root': Permissão negada\r\n${tmpPrompt}`, { includes: 'Permissão negada' })
  add('find / -name teste 2>&1', `find / -name teste 2>&1\r\nfind: '/proc/1/map_files': Permissão negada\n/tmp/teste\r\n${tmpPrompt}`, { includes: ['/tmp/teste', 'Permissão negada'] })

  add('rpm -qa', `rpm -qa\r\nbash-4.4.20-6.el8.x86_64\nopenssh-server-8.0p1-25.el8.x86_64\r\n${tmpPrompt}`, { includes: 'openssh-server' })
  add('dnf history', `dnf history\r\nID | Command line | Date and time\n42 | update | 2026-07-18\r\n${tmpPrompt}`, { includes: '42 | update' })
  add('tar czf teste.tar.gz teste.txt', `tar czf teste.tar.gz teste.txt\r\n${tmpPrompt}`)
  add('sha256sum teste.tar.gz', `sha256sum teste.tar.gz\r\nabc123  teste.tar.gz\r\n${tmpPrompt}`, { includes: 'abc123' })

  add('export TESTE=123', `export TESTE=123\r\n${tmpPrompt}`)
  add('echo $TESTE', `echo $TESTE\r\n123\r\n${tmpPrompt}`, { includes: '123' })
  add('echo arquivo{1..10}', `echo arquivo{1..10}\r\narquivo1 arquivo2 arquivo3 arquivo4 arquivo5 arquivo6 arquivo7 arquivo8 arquivo9 arquivo10\r\n${tmpPrompt}`, { includes: 'arquivo10' })
  add('history', `history\r\n  1 pwd\n  2 whoami\n  3 history\r\n${tmpPrompt}`, { includes: '3 history' })
  add('!!', `!!\r\nhistory\n  1 pwd\n  2 whoami\n  3 history\r\n${tmpPrompt}`, { includes: 'history' })

  add('ls --color=always', `ls --color=always\r\n\x1b[38;5;33manaconda\x1b[0m  \x1b[38;5;33maudit\x1b[0m  dnf.log\r\n${tmpPrompt}`, { includes: ['anaconda', 'dnf.log'], excludes: ['\x1b[38;5;33m'] })
  add('grep --color root /etc/passwd', `grep --color root /etc/passwd\r\n\x1b[01;31mroot\x1b[00m:x:0:0:root:/root:/bin/bash\r\n${tmpPrompt}`, { includes: 'root:x:0:0' })
  add("printf '\\033[31mVERMELHO\\033[0m\\n'", `printf '\\033[31mVERMELHO\\033[0m\\n'\r\n\x1b[31mVERMELHO\x1b[0m\r\n${tmpPrompt}`, { includes: 'VERMELHO', excludes: '\x1b[31m' })
  add('echo "çãáéíóú"', `echo "çãáéíóú"\r\nçãáéíóú\r\n${tmpPrompt}`, { includes: 'çãáéíóú' })
  add('echo "日本語"', `echo "日本語"\r\n日本語\r\n${tmpPrompt}`, { includes: '日本語' })
  add('echo "😀😁😂🤣😎"', `echo "😀😁😂🤣😎"\r\n😀😁😂🤣😎\r\n${tmpPrompt}`, { includes: '😀😁😂🤣😎' })

  add('for i in {1..100}; do printf "\\rProgresso %d%%" $i; done; echo', `for i in {1..100}; do printf "\\rProgresso %d%%" $i; done; echo\r\n${Array.from({ length: 100 }, (_, index) => `Progresso ${index + 1}%`).join('\r')}\r\n${tmpPrompt}`, { includes: 'Progresso 100%' })
  add('tput clear', `tput clear\r\n\x1b[H\x1b[2J${tmpPrompt}`, { excludes: ['\x1b[H', '\x1b[2J'] })
  add('tput cup 10 20', `tput cup 10 20\r\n\x1b[10;20H${tmpPrompt}`, { excludes: '\x1b[10;20H' })
  add('echo "CENTRO"', `echo "CENTRO"\r\nCENTRO\r\n${tmpPrompt}`, { includes: 'CENTRO' })
  add('printf "\\033[2J"', `printf "\\033[2J"\r\n\x1b[2J${tmpPrompt}`, { excludes: '\x1b[2J' })

  add('echo abcdefgh', `echo abcdefgh\r\nabcdefgh\r\n${tmpPrompt}`, { includes: 'abcdefgh' })
  events.push(event(state.seq++, 'stdin', 'ping google.com\r', state.offset += 2))
  events.push(event(state.seq++, 'stdout', 'ping google.com\r\n64 bytes from google.com: icmp_seq=1 ttl=117 time=10.1 ms\n64 bytes from google.com: icmp_seq=2 ttl=117 time=10.0 ms\n', state.offset += 2))
  events.push(event(state.seq++, 'stdin', '\x03', state.offset += 1))
  events.push(event(state.seq++, 'stdout', '^C\r\n--- google.com ping statistics ---\n2 packets transmitted, 2 received\r\n' + tmpPrompt, state.offset += 2))
  expected.push({ command: 'ping google.com', outputIncludes: ['Saída interativa contínua detectada', '2 packets transmitted'], interactive: true })

  events.push(event(state.seq++, 'stdin', 'cat\r', state.offset += 2))
  events.push(event(state.seq++, 'stdout', 'cat\r\n', state.offset += 1))
  events.push(event(state.seq++, 'stdin', 'linha alfa\nlinha beta\n', state.offset += 2))
  events.push(event(state.seq++, 'stdin', '\x04', state.offset += 1))
  events.push(event(state.seq++, 'stdout', 'linha alfa\r\nlinha beta\r\n' + tmpPrompt, state.offset += 2))
  expected.push({ command: 'cat', outputIncludes: ['Saída interativa contínua detectada', 'linha alfa', 'linha beta'], interactive: true })

  add('cat /etc/pas\t', `cat /etc/passwd\r\nroot:x:0:0:root:/root:/bin/bash\r\n${tmpPrompt}`, { expectedCommand: 'cat /etc/pas', includes: 'root:x:0:0' })
  add('echo ~', `echo ~\r\n/home/suporte\r\n${tmpPrompt}`, { includes: '/home/suporte' })
  add('echo ${HOME}', `echo \${HOME}\r\n/home/suporte\r\n${tmpPrompt}`, { includes: '/home/suporte' })
  add('echo $(date)', `echo $(date)\r\nSat Jul 18 16:50:00 -03 2026\r\n${tmpPrompt}`, { includes: '2026' })
  add('for i in {1..20}; do echo $i; done', `for i in {1..20}; do echo $i; done\r\n${Array.from({ length: 20 }, (_, index) => String(index + 1)).join('\n')}\r\n${tmpPrompt}`, { includes: ['1', '20'] })
  add('seq 1 10000', `seq 1 10000\r\n${Array.from({ length: 400 }, (_, index) => String(index + 1)).join('\n')}\n...\n10000\r\n${tmpPrompt}`, { includes: ['1', '400', '10000'] })
  add('yes "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" | head -1000', `yes "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" | head -1000\r\n${Array.from({ length: 120 }, () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').join('\n')}\r\n${tmpPrompt}`, { includes: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })

  add('vim teste.txt', `vim teste.txt\r\n\x1b[?1049h\x1b[H"teste.txt" 2L, 28C\r\nPrimeira linha\r\nSegunda linha\r\n\x1b[?1049l${tmpPrompt}`, { includes: 'Saída interativa contínua detectada', excludes: ['Primeira linha', '"teste.txt"'], interactive: true })
  add('less /etc/passwd', `less /etc/passwd\r\nroot:x:0:0:root:/root:/bin/bash\nbin:x:1:1:bin:/bin:/sbin/nologin\nlines 1-2/2 (END)`, { includes: ['Saída interativa contínua detectada', 'root:x:0:0'], excludes: 'lines 1-2/2 (END)', interactive: true })
  events.push(event(state.seq++, 'stdin', 'q', state.offset += 1))
  events.push(event(state.seq++, 'stdout', '\x1b>' + tmpPrompt, state.offset += 1))

  add('PS1="NODEACCESS> "', `PS1="NODEACCESS> "\r\n${nodePrompt}`)
  add('cd /', `cd /\r\n${rootPrompt}`, { expectedCommand: 'cd /' })
  add('exit', 'exit\r\nlogout\r\n', { includes: 'logout' })
  events.push(event(state.seq++, 'session_ended', null, state.offset += 5))

  return { events, expected }
}

function realisticSession4177Events(): { events: SessionAuditPreviewEvent[]; expected: CommandExpectation[] } {
  const events: SessionAuditPreviewEvent[] = []
  let seq = 1
  let offset = 0
  const homePrompt = '[suporte@Dinamico-132-19 ~]$ '
  const logPrompt = '[suporte@Dinamico-132-19 log]$ '
  events.push(event(seq++, 'session_started', null, offset))
  events.push(event(seq++, 'stdout', homePrompt, offset += 2))

  events.push(event(seq++, 'stdin', 'ls -lha\r', offset += 2))
  events.push(event(seq++, 'stdout', [
    'ls -lha',
    'total 44K',
    'drwx------. 5 suporte suporte 4,0K mai 19 10:33 .',
    '-rw-------. 1 suporte suporte 1,1K jul  7 10:02 .bash_history',
    homePrompt,
  ].join('\r\n'), offset += 3))

  events.push(event(seq++, 'stdin', 'htop\r', offset += 2))
  events.push(event(seq++, 'stdout', '\x1b[?1049h\x1b[H  PID USER VIRT RES CPU% MEM% Command\r\n 626 mysql 12.5G 6383M 40.5 mysqld\r\n 4173 root 5747M java -jar /app/PrePaidEngine-v0.0.9.jar\x1b[?1049l', offset += 3))
  events.push(event(seq++, 'stdin', 'q', offset += 1))
  events.push(event(seq++, 'stdout', homePrompt, offset += 2))

  for (const char of 'ifocnfig') {
    events.push(event(seq++, 'stdin', char, offset += 1))
    events.push(event(seq++, 'stdout', char, offset += 1))
  }
  events.push(event(seq++, 'stdin', '\r', offset += 1))
  events.push(event(seq++, 'stdout', '\r\n-bash: ifocnfig: comando não encontrado\r\n' + homePrompt, offset += 3))

  events.push(event(seq++, 'stdin', 'ifconfig\r', offset += 2))
  events.push(event(seq++, 'stdout', 'ifconfig\r\nens18: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>\r\n        inet 168.227.132.19\r\n' + homePrompt, offset += 3))

  events.push(event(seq++, 'stdin', 'cd /va\tr/log\r', offset += 2))
  events.push(event(seq++, 'stdout', `\r\n\x1b]0;suporte@Dinamico-132-19:/var/log\x07${logPrompt}`, offset += 2))
  events.push(event(seq++, 'stdin', 'ls\r', offset += 2))
  events.push(event(seq++, 'stdout', 'ls\r\nanaconda cron dnf.log dnf.rpm.log messages mysqld.log secure zabbix\r\n' + logPrompt, offset += 3))

  events.push(event(seq++, 'stdin', 'vim dnf\tl\to\t\r', offset += 2))
  events.push(event(seq++, 'stdout', '\x1b[?1049h\x1b[H"dnf.log" [somente-leitura] 6342L, 563832C\r\n2026-07-06T19:32:02-0300 DEBUG DNF version: 4.7.0\r\n2026-07-06T19:32:02-0300 DDEBUG Command: dnf makecache --timer', offset += 3))
  events.push(event(seq++, 'stdin', ':q!\r', offset += 2))
  events.push(event(seq++, 'stdout', '\x1b[?1049l' + logPrompt, offset += 2))
  events.push(event(seq++, 'session_ended', null, offset += 5))

  return {
    events,
    expected: [
      { command: 'ls -lha', outputIncludes: ['total 44K', '.bash_history'] },
      { command: 'htop', outputIncludes: 'Saída interativa contínua detectada', outputExcludes: ['mysqld', 'PrePaidEngine'], interactive: true },
      { command: 'ifocnfig', outputIncludes: 'ifocnfig: comando não encontrado' },
      { command: 'ifconfig', outputIncludes: ['ens18', '168.227.132.19'] },
      { command: 'cd /var/log' },
      { command: 'ls', outputIncludes: ['dnf.log', 'mysqld.log', 'zabbix'] },
      { command: 'vim dnf.log', outputIncludes: 'Saída interativa contínua detectada', outputExcludes: ['DEBUG DNF version', 'makecache'], interactive: true },
    ],
  }
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomChoice<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0]!
}

function typeCommandEvents(
  events: SessionAuditPreviewEvent[],
  input: string,
  output: string,
  state: { seq: number; offset: number },
  options: { split?: boolean; echo?: boolean } = {},
) {
  if (options.split) {
    for (const char of input) {
      events.push(event(state.seq++, 'stdin', char, state.offset += 1))
      if (options.echo && char !== '\r') events.push(event(state.seq++, 'stdout', char, state.offset += 1))
    }
  } else {
    events.push(event(state.seq++, 'stdin', input, state.offset += 2))
  }
  events.push(event(state.seq++, 'stdout', output, state.offset += 3))
}

function asArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function normalizedComparable(value: string) {
  return stripAnsi(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function diverseCommandScenario(count: number, seed: number): { events: SessionAuditPreviewEvent[]; expected: CommandExpectation[] } {
  const random = createSeededRandom(seed)
  const events: SessionAuditPreviewEvent[] = []
  const expected: CommandExpectation[] = []
  const state = { seq: 1, offset: 0 }
  events.push(event(state.seq++, 'session_started', null, state.offset))
  events.push(event(state.seq++, 'stdout', prompt(0), state.offset += 2))

  const templates = [
    (i: number) => ({
      command: `whoami # NA-MIX-${i}`,
      output: `whoami # NA-MIX-${i}\r\nsuporte\r\n${prompt(i)}`,
      marker: 'suporte',
    }),
    (i: number) => ({
      command: `printf 'NA-MIX-${i}\\nlinha-2\\n'`,
      output: `printf 'NA-MIX-${i}\\nlinha-2\\n'\r\nNA-MIX-${i}\nlinha-2\r\n${prompt(i)}`,
      marker: `NA-MIX-${i}`,
    }),
    (i: number) => ({
      command: `grep NA-MIX-${i} /tmp/nodeaccess-audit-playback.log`,
      output: `grep NA-MIX-${i} /tmp/nodeaccess-audit-playback.log\r\n/tmp/nodeaccess-audit-playback.log:NA-MIX-${i}\r\n${prompt(i)}`,
      marker: `NA-MIX-${i}`,
    }),
    (i: number) => ({
      command: `ls -lha /tmp/nodeaccess-audit-playback-${i}`,
      output: `ls -lha /tmp/nodeaccess-audit-playback-${i}\r\nls: não foi possível acessar '/tmp/nodeaccess-audit-playback-${i}': Arquivo ou diretório inexistente\r\n${prompt(i)}`,
      marker: 'Arquivo ou diretório inexistente',
    }),
    (i: number) => ({
      command: `cat /etc/hosts | head -${(i % 5) + 1}`,
      output: `cat /etc/hosts | head -${(i % 5) + 1}\r\n127.0.0.1 localhost\r\n::1 localhost\r\n${prompt(i)}`,
      marker: 'localhost',
    }),
    (i: number) => ({
      command: `seq 1 ${(i % 30) + 20}`,
      output: `seq 1 ${(i % 30) + 20}\r\n${Array.from({ length: (i % 30) + 20 }, (_, index) => String(index + 1)).join('\n')}\r\n${prompt(i)}`,
      marker: String((i % 30) + 20),
    }),
  ]

  for (let i = 1; i <= count; i += 1) {
    const built = randomChoice(templates, random)(i)
    let input = `${built.command}\r`
    let expectedCommand = built.command
    if (i % 17 === 0) {
      input = `echp\b\bho typo-fixed-${i}\r`
      expectedCommand = `echo typo-fixed-${i}`
      built.output = `echo typo-fixed-${i}\r\ntypo-fixed-${i}\r\n${prompt(i)}`
      built.marker = `typo-fixed-${i}`
    }
    if (i % 23 === 0) {
      events.push(event(state.seq++, 'resize', null, state.offset += 1, { cols: 100 + (i % 60), rows: 30 + (i % 20) }))
    }
    typeCommandEvents(events, input, built.output, state, {
      split: i % 5 === 0,
      echo: i % 5 === 0,
    })
    expected.push({ command: expectedCommand, outputIncludes: built.marker })
  }

  events.push(event(state.seq++, 'session_ended', null, state.offset += 5))
  return { events, expected }
}

function evaluateScenario(name: string, events: SessionAuditPreviewEvent[], expected: CommandExpectation[]): ScenarioResult {
  const started = performance.now()
  const commands = buildCommandTimeline(events)
  const durationMs = Math.round(performance.now() - started)
  const findings: string[] = []
  const samples: ScenarioResult['samples'] = []
  let exactCommandMatches = 0
  let outputMatches = 0
  let outputExclusionMatches = 0
  let outputChecks = 0
  let outputExclusionChecks = 0
  let interactiveCommands = 0

  if (commands.length !== expected.length) {
    findings.push(`Quantidade reconstruida divergente: esperado ${expected.length}, recebido ${commands.length}`)
  }

  const max = Math.max(commands.length, expected.length)
  for (let i = 0; i < max; i += 1) {
    const actual = commands[i] ?? null
    const item = expected[i] ?? null
    if (!item) {
      findings.push(`Comando extra em #${i + 1}: ${actual?.command ?? '—'}`)
      continue
    }
    const commandOk = actual?.command === item.command
    if (commandOk) exactCommandMatches += 1
    if (item.interactive) interactiveCommands += 1
    const actualOutput = normalizedComparable(actual?.output ?? '')
    const requiredOutput = asArray(item.outputIncludes)
    const forbiddenOutput = asArray(item.outputExcludes)
    outputChecks += requiredOutput.length
    outputExclusionChecks += forbiddenOutput.length
    const outputOk = item.allowOutputMismatch || requiredOutput.every((marker) => actualOutput.includes(normalizedComparable(marker)))
    const outputExclusionsOk = forbiddenOutput.every((marker) => {
      const normalizedMarker = normalizedComparable(marker)
      if (!normalizedMarker) return !(actual?.output ?? '').includes(marker)
      return !actualOutput.includes(normalizedMarker)
    })
    if (outputOk) outputMatches += requiredOutput.length
    if (outputExclusionsOk) outputExclusionMatches += forbiddenOutput.length
    if (!commandOk) findings.push(`#${i + 1}: comando esperado "${item.command}", recebido "${actual?.command ?? '—'}"`)
    if (!outputOk) findings.push(`#${i + 1}: output nao contem marcador(es) ${JSON.stringify(requiredOutput)}`)
    if (!outputExclusionsOk) findings.push(`#${i + 1}: output contem marcador(es) proibido(s) ${JSON.stringify(forbiddenOutput)}`)
    if (i < 5 || !commandOk || !outputOk || !outputExclusionsOk || i >= max - 3) {
      samples.push({
        index: i + 1,
        expected: item.command,
        actual: actual?.command ?? null,
        outputOk,
        outputExclusionsOk,
        confidence: actual?.confidence ?? null,
      })
    }
  }

  const commandScore = expected.length > 0 ? exactCommandMatches / expected.length : 1
  const outputScore = outputChecks > 0 ? outputMatches / outputChecks : 1
  const exclusionScore = outputExclusionChecks > 0 ? outputExclusionMatches / outputExclusionChecks : 1
  const countScore = expected.length === commands.length ? 1 : 0
  const fidelityScore = Number(((commandScore * 0.45) + (outputScore * 0.3) + (exclusionScore * 0.15) + (countScore * 0.1)).toFixed(4))

  return {
    name,
    ok: findings.length === 0,
    expectedCommands: expected.length,
    actualCommands: commands.length,
    exactCommandMatches,
    outputMatches,
    outputExclusionMatches,
    interactiveCommands,
    fidelityScore,
    durationMs,
    findings: findings.slice(0, 30),
    samples,
  }
}

function main() {
  const scenarios: ScenarioResult[] = []
  for (const count of [100, 200, 300]) {
    const generated = bulkEvents(count)
    scenarios.push(evaluateScenario(`bulk-${count}-linear-commands`, generated.events, generated.expected))
  }

  const combined = combinedOutputEvents(100)
  scenarios.push(evaluateScenario('combined-stdout-100-commands', combined.events, combined.expected))

  const editor = editorAndControlEvents()
  scenarios.push(evaluateScenario('editor-backspace-pager-control', editor.events, editor.expected))

  const tuiExitCarryover = tuiExitCarryoverEvents()
  scenarios.push(evaluateScenario('tui-exit-key-does-not-prefix-next-command', tuiExitCarryover.events, tuiExitCarryover.expected))

  const shellEdges = shellFidelityEdgeEvents()
  scenarios.push(evaluateScenario('shell-fidelity-edge-cases', shellEdges.events, shellEdges.expected))

  const comprehensivePlan = comprehensiveAuditPlanEvents()
  scenarios.push(evaluateScenario('comprehensive-audit-plan-terminal-behaviors', comprehensivePlan.events, comprehensivePlan.expected))

  const realistic4177 = realisticSession4177Events()
  scenarios.push(evaluateScenario('realistic-session-4177-playback-command-crosscheck', realistic4177.events, realistic4177.expected))

  for (const count of RANDOM_COUNTS) {
    const mixed = diverseCommandScenario(count, 0xC0FFEE + count)
    scenarios.push(evaluateScenario(`mixed-randomized-${count}-commands`, mixed.events, mixed.expected))
  }

  const outputCleaning = cleanCommandOutput('echo ok\r\nok\r\n[suporte@nodeaccess ~]$ ', 'echo ok')
  const ansiCleaning = stripAnsi('\x1b[32mok\x1b[0m')
  const extraFindings: string[] = []
  if (outputCleaning !== 'ok') extraFindings.push(`cleanCommandOutput baseline divergente: ${JSON.stringify(outputCleaning)}`)
  if (ansiCleaning !== 'ok') extraFindings.push(`stripAnsi baseline divergente: ${JSON.stringify(ansiCleaning)}`)

  const report = {
    ok: scenarios.every((scenario) => scenario.ok) && extraFindings.length === 0,
    startedAt: new Date().toISOString(),
    reportPath: REPORT_PATH,
    scope: 'session-audit command reconstruction fidelity',
    scenarios,
    extraFindings,
    recommendations: [
      'Usar este teste antes/depois de alterar gateway SSH, auditoria, normalizer ou playback.',
      'Quando uma sessao real tiver comandos divergentes, anexar o JSONL bruto e criar novo vetor sintetico aqui antes de corrigir.',
      'O teste de UI CDP valida renderizacao; este teste valida a reconstrucao deterministica do interpretador.',
      'Os cenarios mixed-randomized usam seed fixa: variam comandos, erros de digitacao, chunking, resize e outputs grandes sem flutuar entre execucoes.',
      'Comandos interativos sao aceitos como resumo fiel de acao, nao como replay textual completo; a trilha bruta deve continuar disponivel para pericia.',
      'Cenarios com senha/secret validam que o comando e a saida operacional sobrevivem sem vazar o segredo.',
    ],
    finishedAt: new Date().toISOString(),
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: report.ok,
    reportPath: REPORT_PATH,
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      ok: scenario.ok,
      expectedCommands: scenario.expectedCommands,
      actualCommands: scenario.actualCommands,
      exactCommandMatches: scenario.exactCommandMatches,
      fidelityScore: scenario.fidelityScore,
      interactiveCommands: scenario.interactiveCommands,
      durationMs: scenario.durationMs,
      findings: scenario.findings.slice(0, 5),
    })),
    extraFindings,
  }, null, 2))

  if (!report.ok) process.exit(1)
}

main()
