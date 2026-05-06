import { describe, expect, it } from 'vitest'
import {
  buildCommandTimeline,
  cleanCommandOutput,
  collapseConsecutivePrompts,
  isLikelyInteractiveCommand,
  looksLikePrompt,
  removeTrailingPrompt,
  stripAnsi,
  summarizeInteractiveOutput,
} from './session-audit-normalizer.js'
import type { SessionAuditPreviewEvent } from '@nodeaccess/shared'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TS = '2026-01-01T00:00:00.000Z'

function stdin(text: string, seq = 1): SessionAuditPreviewEvent {
  return { seq, timestamp: TS, type: 'stdin', text, bytes: text.length, cols: null, rows: null }
}

function stdout(text: string, seq = 2): SessionAuditPreviewEvent {
  return { seq, timestamp: TS, type: 'stdout', text, bytes: text.length, cols: null, rows: null }
}

function ended(seq = 99): SessionAuditPreviewEvent {
  return { seq, timestamp: TS, type: 'session_ended', text: null, bytes: null, cols: null, rows: null }
}

// ─── stripAnsi ────────────────────────────────────────────────────────────────

describe('stripAnsi', () => {
  it('removes CSI color sequences', () => {
    expect(stripAnsi('\x1b[32mGreen\x1b[0m')).toBe('Green')
  })

  it('removes CSI cursor positioning', () => {
    expect(stripAnsi('\x1b[H\x1b[2J')).toBe('')
  })

  it('removes OSC title sequences', () => {
    expect(stripAnsi('\x1b]0;root@host:~\x07prompt')).toBe('prompt')
  })

  it('removes DECPNM (ESC >) — reported artifact after less exits', () => {
    expect(stripAnsi('text\x1b>more')).toBe('textmore')
  })

  it('removes DECPAM (ESC =)', () => {
    expect(stripAnsi('\x1b=text')).toBe('text')
  })

  it('removes save/restore cursor (ESC 7 / ESC 8)', () => {
    expect(stripAnsi('\x1b7text\x1b8')).toBe('text')
  })

  it('removes alternate screen switch ESC[?1049h', () => {
    expect(stripAnsi('\x1b[?1049hcontent\x1b[?1049l')).toBe('content')
  })

  it('removes bold/dim/italic CSI sequences', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[2mdim\x1b[3mitalic\x1b[m')).toBe('bolddimitalic')
  })

  it('removes 256-color foreground sequences', () => {
    expect(stripAnsi('\x1b[38;5;196mred\x1b[0m')).toBe('red')
  })

  it('removes RGB truecolor sequences', () => {
    expect(stripAnsi('\x1b[38;2;255;0;0mred\x1b[0m')).toBe('red')
  })

  it('preserves plain text without sequences', () => {
    expect(stripAnsi('plain text without escapes')).toBe('plain text without escapes')
  })

  it('handles real less pager exit artifact', () => {
    const raw = 'lines 1-21/21 (END)\x1b>[suporte@SBC-TIM-CCO ~]$ '
    expect(stripAnsi(raw)).toBe('lines 1-21/21 (END)[suporte@SBC-TIM-CCO ~]$ ')
  })
})

// ─── looksLikePrompt ─────────────────────────────────────────────────────────

describe('looksLikePrompt', () => {
  it('detects bracket-style root prompt', () => {
    expect(looksLikePrompt('[root@localhost log]# ')).toBe(true)
  })

  it('detects user prompt with $', () => {
    expect(looksLikePrompt('[suporte@SBC-TIM-CCO ~]$ ')).toBe(true)
  })

  it('detects simple prompt without brackets', () => {
    expect(looksLikePrompt('root@host:~# ')).toBe(true)
  })

  it('does not flag real output lines', () => {
    expect(looksLikePrompt('boot.log-20250521  btmp-20260415      cron')).toBe(false)
  })

  it('does not flag empty string', () => {
    expect(looksLikePrompt('')).toBe(false)
  })

  it('does not flag partial prompts', () => {
    expect(looksLikePrompt('[root@localhost log]')).toBe(false)
  })
})

// ─── removeTrailingPrompt ────────────────────────────────────────────────────

describe('removeTrailingPrompt', () => {
  it('removes single trailing prompt', () => {
    const input = 'some output\n[root@localhost ~]#'
    expect(removeTrailingPrompt(input)).toBe('some output')
  })

  it('removes multiple trailing prompts', () => {
    const input = 'output\n[root@localhost ~]#\n[root@localhost ~]#'
    expect(removeTrailingPrompt(input)).toBe('output')
  })

  it('does not remove prompt in the middle', () => {
    const input = '[root@localhost ~]#\noutput'
    expect(removeTrailingPrompt(input)).toBe('[root@localhost ~]#\noutput')
  })

  it('preserves content-only output', () => {
    const input = 'total 48\ndrwxr-xr-x 5 root root'
    expect(removeTrailingPrompt(input)).toBe(input)
  })
})

// ─── collapseConsecutivePrompts ──────────────────────────────────────────────

describe('collapseConsecutivePrompts', () => {
  it('collapses many consecutive identical prompts into one', () => {
    const repeated = Array(10).fill('[root@localhost log]#').join('\n')
    const result = collapseConsecutivePrompts(repeated)
    expect(result).toBe('[root@localhost log]#')
  })

  it('preserves output between non-consecutive prompts', () => {
    const input = '[root@localhost ~]#\nls output\n[root@localhost tmp]#'
    expect(collapseConsecutivePrompts(input)).toBe(input)
  })

  it('keeps one prompt when multiple appear at the end', () => {
    const input = 'output\n[root@localhost ~]#\n[root@localhost ~]#\n[root@localhost ~]#'
    expect(collapseConsecutivePrompts(input)).toBe('output\n[root@localhost ~]#')
  })

  it('keeps first prompt when alternating with empty lines', () => {
    const input = '[root@localhost ~]#\n[root@localhost ~]#\n\n[root@localhost ~]#'
    const result = collapseConsecutivePrompts(input)
    const promptCount = result.split('\n').filter(l => looksLikePrompt(l)).length
    expect(promptCount).toBeLessThan(3)
  })
})

// ─── cleanCommandOutput — \r handling ────────────────────────────────────────

describe('cleanCommandOutput — carriage return handling', () => {
  it('lone \\r between prompts becomes newline, not concatenation', () => {
    const prompt = '[root@localhost log]# '
    // Terminal sends \r to redraw prompt on same line — should not concat
    const raw = `${prompt}\r${prompt}\r${prompt}`
    const result = cleanCommandOutput(raw, 'ls')
    // Should not contain "# [root" (concatenated inline prompts)
    expect(result).not.toContain('# [root')
  })

  it('\\r\\n becomes single newline', () => {
    const raw = 'line1\r\nline2\r\nline3'
    const result = cleanCommandOutput(raw, 'cat file')
    expect(result).toBe('line1\nline2\nline3')
  })

  it('output from ls /var/log with repeated prompts is cleaned', () => {
    const files = 'boot.log-20250521  btmp-20260415      cron-20260419  iptraf-ng           maillog-20260419  ntpstats           secure-20260415  spooler-20260419'
    const prompts = Array(11).fill('[root@localhost log]#').join('\r')
    const raw = files + '\r\n' + prompts
    const result = cleanCommandOutput(raw, 'ls')
    expect(result).toContain('boot.log-20250521')
    // Should not have many consecutive inline prompts
    const promptMatches = (result.match(/\[root@localhost log\]#/g) ?? []).length
    expect(promptMatches).toBeLessThanOrEqual(1)
  })
})

// ─── summarizeInteractiveOutput — pager artifacts ────────────────────────────

describe('summarizeInteractiveOutput — pager artifacts', () => {
  it('filters "lines N-N/N (END)" pager status line', () => {
    const output = 'line1\nline2\nlines 1-21/21 (END)'
    const result = summarizeInteractiveOutput('less /var/log/messages', output)
    expect(result).not.toContain('lines 1-21/21 (END)')
    expect(result).toContain('line1')
  })

  it('filters "(END)" alone', () => {
    const output = 'content here\n(END)'
    const result = summarizeInteractiveOutput('less file', output)
    expect(result).not.toContain('(END)')
  })

  it('filters "--More--"', () => {
    const output = 'A lot of content\n--More--'
    const result = summarizeInteractiveOutput('more /etc/fstab', output)
    expect(result).not.toContain('--More--')
  })

  it('returns empty-output message when only pager status lines remain', () => {
    const output = 'lines 1-5/5 (END)\n(END)'
    const result = summarizeInteractiveOutput('less file', output)
    expect(result).toContain('Use Preview/Download')
  })

  it('shows last lines of real less content without status bar', () => {
    const contentLines = Array.from({ length: 30 }, (_, i) => `Log entry ${i + 1}`)
    const output = contentLines.join('\n') + '\nlines 1-30/30 (END)'
    const result = summarizeInteractiveOutput('less /var/log/syslog', output)
    expect(result).toContain('Log entry 30')
    expect(result).not.toContain('lines 1-30/30 (END)')
  })
})

// ─── buildCommandTimeline — list commands ────────────────────────────────────

describe('buildCommandTimeline — ls / find / du', () => {
  it('captures ls output correctly', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('ls -la\r', 1),
      stdout('ls -la\r\ntotal 32\ndrwxr-xr-x 2 root root 4096 Apr 26 10:00 .\n[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands).toHaveLength(1)
    expect(commands[0]?.command).toBe('ls -la')
    expect(commands[0]?.output).toContain('total 32')
    expect(commands[0]?.output).not.toContain('[root@localhost ~]#')
  })

  it('captures find output', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('find /var/log -name "*.log"\r', 1),
      stdout('find /var/log -name "*.log"\r\n/var/log/messages\n/var/log/secure\n/var/log/cron\n[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('/var/log/messages')
    expect(commands[0]?.output).toContain('/var/log/secure')
    expect(commands[0]?.output).not.toContain('[root@localhost ~]#')
  })

  it('captures du -sh output', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('du -sh /var/*\r', 1),
      stdout('du -sh /var/*\r\n4.0K\t/var/empty\n1.2G\t/var/log\n128M\t/var/cache\n[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('1.2G')
    expect(commands[0]?.output).toContain('/var/log')
  })

  it('strips ANSI colors from ls --color output', () => {
    const coloredLs = '\x1b[0m\x1b[01;34mdir\x1b[0m  \x1b[01;32mfile.sh\x1b[0m  plain.txt'
    const events: SessionAuditPreviewEvent[] = [
      stdin('ls --color\r', 1),
      stdout(`ls --color\r\n${coloredLs}\n[root@localhost ~]# `, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('dir')
    expect(commands[0]?.output).toContain('file.sh')
    expect(commands[0]?.output).toContain('plain.txt')
    expect(commands[0]?.output).not.toContain('\x1b[')
  })
})

// ─── buildCommandTimeline — copy / move ──────────────────────────────────────

describe('buildCommandTimeline — cp / mv / rsync', () => {
  it('captures cp with no output (success)', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('cp /etc/hosts /tmp/hosts.bak\r', 1),
      stdout('[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toBe('cp /etc/hosts /tmp/hosts.bak')
    expect(commands[0]?.output).toBe('')
  })

  it('captures mv output', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('mv /tmp/oldfile /tmp/newfile\r', 1),
      stdout('[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toBe('mv /tmp/oldfile /tmp/newfile')
  })

  it('captures rsync verbose output', () => {
    const rsyncOut = [
      'sending incremental file list',
      'file1.txt',
      'file2.txt',
      '',
      'sent 1,234 bytes  received 42 bytes  2,552.00 bytes/sec',
      'total size is 98,304  speedup is 76.91',
      '[root@localhost ~]# ',
    ].join('\n')
    const events: SessionAuditPreviewEvent[] = [
      stdin('rsync -av /src/ /dst/\r', 1),
      stdout(`rsync -av /src/ /dst/\r\n${rsyncOut}`, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('sent 1,234 bytes')
    expect(commands[0]?.output).not.toContain('[root@localhost ~]#')
  })
})

// ─── buildCommandTimeline — interactive commands ──────────────────────────────

describe('buildCommandTimeline — interactive (less, vim, top)', () => {
  it('marks less as low confidence', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('less /var/log/messages\r', 1),
      stdout('\x1b[?1049h\x1b[H\x1b[2JLog content line 1\nLog content line 2\nlines 1-50/1024 (END)', 2),
      stdin('q', 3),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const lessCmd = commands.find(c => c.command.startsWith('less'))
    expect(lessCmd).toBeDefined()
    expect(lessCmd?.confidence).toBe('low')
    expect(lessCmd?.output).not.toContain('lines 1-50/1024 (END)')
    expect(lessCmd?.output).toContain('Saída interativa contínua detectada')
  })

  it('marks vim as low confidence and includes summary', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('vim /etc/nginx/nginx.conf\r', 1),
      stdout('\x1b[?1049h\x1b[H-- INSERT --\nserver {\n  listen 80;\n}\n~\n~\n"/etc/nginx/nginx.conf" 10L, 200B', 2),
      stdin('\x1b:wq\r', 3),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const vimCmd = commands.find(c => c.command.startsWith('vim'))
    expect(vimCmd?.confidence).toBe('low')
    expect(vimCmd?.output).toContain('Saída interativa contínua detectada')
  })

  it('filters pager status from less output summary', () => {
    const pagerOutput = [
      '\x1b[?1049h',
      'Jan  1 00:00:01 localhost kernel: Boot OK',
      'Jan  1 00:00:02 localhost sshd[1234]: Accepted',
      'lines 1-21/21 (END)',
    ].join('\n')
    const events: SessionAuditPreviewEvent[] = [
      stdin('less /var/log/boot.log\r', 1),
      stdout(pagerOutput, 2),
      stdin('q', 3),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const lessCmd = commands.find(c => c.command.startsWith('less'))
    expect(lessCmd?.output).not.toContain('lines 1-21/21 (END)')
    expect(lessCmd?.output).not.toContain('(END)')
  })
})

// ─── buildCommandTimeline — multiple commands in sequence ─────────────────────

describe('buildCommandTimeline — sequence of commands', () => {
  it('correctly sequences cd + ls + cat', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('cd /etc\r', 1),
      stdout('[root@localhost etc]# ', 2),
      stdin('ls\r', 3),
      stdout('ls\r\nhosts  resolv.conf  passwd  shadow\n[root@localhost etc]# ', 4),
      stdin('cat /etc/hosts\r', 5),
      stdout('cat /etc/hosts\r\n127.0.0.1   localhost\n192.168.1.1  router\n[root@localhost etc]# ', 6),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands.length).toBeGreaterThanOrEqual(2)
    const lsCmd = commands.find(c => c.command === 'ls')
    expect(lsCmd?.output).toContain('hosts')
    const catCmd = commands.find(c => c.command.startsWith('cat'))
    expect(catCmd?.output).toContain('127.0.0.1')
  })

  it('handles many Enter presses without creating phantom commands', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('whoami\r', 1),
      stdout('root\n[root@localhost ~]# ', 2),
      // User presses Enter 8 times
      stdin('\r', 3), stdin('\r', 4), stdin('\r', 5), stdin('\r', 6),
      stdin('\r', 7), stdin('\r', 8), stdin('\r', 9), stdin('\r', 10),
      stdout('[root@localhost ~]# \r[root@localhost ~]# \r[root@localhost ~]# \r[root@localhost ~]# \r[root@localhost ~]# \r[root@localhost ~]# \r[root@localhost ~]# \r[root@localhost ~]# ', 11),
      stdin('id\r', 12),
      stdout('uid=0(root) gid=0(root) groups=0(root)\n[root@localhost ~]# ', 13),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    // Only whoami and id should survive — no phantom empty commands
    const commandNames = commands.map(c => c.command)
    expect(commandNames).toContain('whoami')
    expect(commandNames).toContain('id')
    expect(commandNames.filter(Boolean)).toEqual(commandNames)
  })

  it('repeated prompts in output are collapsed to max 1 trailing prompt', () => {
    const manyPrompts = Array(10).fill('[root@localhost log]# ').join('\r')
    const events: SessionAuditPreviewEvent[] = [
      stdin('ls /var/log\r', 1),
      stdout(`ls /var/log\r\nboot.log  secure  messages\r\n${manyPrompts}`, 2),
      stdin('cat /etc/hostname\r', 3),
      stdout('myserver\n[root@localhost log]# ', 4),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const lsCmd = commands.find(c => c.command === 'ls /var/log')
    const promptMatches = (lsCmd?.output.match(/\[root@localhost log\]#/g) ?? []).length
    expect(promptMatches).toBeLessThanOrEqual(1)
  })
})

// ─── buildCommandTimeline — package management ───────────────────────────────

describe('buildCommandTimeline — yum / dnf / rpm', () => {
  it('captures yum install output', () => {
    const yumOut = [
      'Loaded plugins: fastestmirror',
      'Loading mirror speeds from cached hostfile',
      'Resolving Dependencies',
      '--> Running transaction check',
      '---> Package curl.x86_64 0:7.76.1-26.el8 will be installed',
      'Complete!',
      '[root@localhost ~]# ',
    ].join('\n')
    const events: SessionAuditPreviewEvent[] = [
      stdin('yum install -y curl\r', 1),
      stdout(`yum install -y curl\r\n${yumOut}`, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toBe('yum install -y curl')
    expect(commands[0]?.output).toContain('Complete!')
    expect(commands[0]?.output).not.toContain('[root@localhost ~]#')
  })

  it('captures rpm -qa output', () => {
    const rpmOut = 'bash-5.1.8-6.el9.x86_64\ncurl-7.76.1-26.el9.x86_64\nopenssl-3.0.7-27.el9.x86_64\n[root@localhost ~]# '
    const events: SessionAuditPreviewEvent[] = [
      stdin('rpm -qa | head -3\r', 1),
      stdout(`rpm -qa | head -3\r\n${rpmOut}`, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('bash-5.1.8')
    expect(commands[0]?.output).not.toContain('[root@localhost ~]#')
  })
})

// ─── buildCommandTimeline — systemctl ─────────────────────────────────────────

describe('buildCommandTimeline — systemctl / service', () => {
  it('captures systemctl status output', () => {
    const statusOut = [
      '● nginx.service - A high performance web server',
      '   Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled)',
      '   Active: active (running) since Sat 2026-04-26 10:00:00 UTC; 2h ago',
      ' Main PID: 1234 (nginx)',
      '[root@localhost ~]# ',
    ].join('\n')
    const events: SessionAuditPreviewEvent[] = [
      stdin('systemctl status nginx\r', 1),
      stdout(`systemctl status nginx\r\n${statusOut}`, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toBe('systemctl status nginx')
    expect(commands[0]?.output).toContain('active (running)')
    expect(commands[0]?.output).not.toContain('[root@localhost ~]#')
  })

  it('resolves "service nginx start" redirect via output', () => {
    const redirectOut = 'Redirecting to /bin/systemctl start nginx.service\n[root@localhost ~]# '
    const events: SessionAuditPreviewEvent[] = [
      stdin('service nginx start\r', 1),
      stdout(`service nginx start\r\n${redirectOut}`, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toMatch(/nginx/)
  })
})

// ─── buildCommandTimeline — network commands ──────────────────────────────────

describe('buildCommandTimeline — network / ip / ss', () => {
  it('captures ip addr show output', () => {
    const ipOut = [
      '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536',
      '    inet 127.0.0.1/8 scope host lo',
      '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500',
      '    inet 192.168.1.24/24 brd 192.168.1.255 scope global eth0',
      '[root@localhost ~]# ',
    ].join('\n')
    const events: SessionAuditPreviewEvent[] = [
      stdin('ip addr show\r', 1),
      stdout(`ip addr show\r\n${ipOut}`, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('192.168.1.24')
    expect(commands[0]?.output).not.toContain('[root@localhost ~]#')
  })

  it('captures ss -tlnp output', () => {
    const ssOut = [
      'State   Recv-Q  Send-Q  Local Address:Port',
      'LISTEN  0       128     0.0.0.0:22',
      'LISTEN  0       128     0.0.0.0:80',
      'LISTEN  0       511     0.0.0.0:443',
      '[root@localhost ~]# ',
    ].join('\n')
    const events: SessionAuditPreviewEvent[] = [
      stdin('ss -tlnp\r', 1),
      stdout(`ss -tlnp\r\n${ssOut}`, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('0.0.0.0:22')
    expect(commands[0]?.output).toContain('0.0.0.0:443')
  })
})

// ─── buildCommandTimeline — grep / awk / sed ──────────────────────────────────

describe('buildCommandTimeline — grep / awk / sed', () => {
  it('captures grep output with ANSI highlights stripped', () => {
    const grepOut = '\x1b[01;31m\x1b[Kroot\x1b[m\x1b[K:x:0:0:root:/root:/bin/bash\n[root@localhost ~]# '
    const events: SessionAuditPreviewEvent[] = [
      stdin('grep root /etc/passwd\r', 1),
      stdout(`grep root /etc/passwd\r\n${grepOut}`, 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('root:x:0:0:root:/root:/bin/bash')
    expect(commands[0]?.output).not.toContain('\x1b[')
  })

  it('captures awk output', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin("awk -F: '{print $1}' /etc/passwd | head -5\r", 1),
      stdout("awk -F: '{print $1}' /etc/passwd | head -5\r\nroot\nbin\ndaemon\nadm\nlp\n[root@localhost ~]# ", 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.output).toContain('root\nbin\ndaemon')
  })
})

// ─── buildCommandTimeline — cd resolution ─────────────────────────────────────

describe('buildCommandTimeline — cd resolution via prompt', () => {
  it('resolves cd to absolute path via new prompt', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('cd /var/log\r', 1),
      stdout('[root@localhost log]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toBe('cd /var/log')
  })

  it('resolves cd via OSC title sequence', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('cd /tmp\r', 1),
      stdout('\x1b]0;root@localhost:/tmp\x07[root@localhost tmp]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toBe('cd /tmp')
  })
})

// ─── buildCommandTimeline — backspace / edit ─────────────────────────────────

describe('buildCommandTimeline — backspace correction in input', () => {
  it('correctly reconstructs command after backspaces', () => {
    // User types "lz" then backspace then "s"
    const events: SessionAuditPreviewEvent[] = [
      stdin('lz\x7fs\r', 1),
      stdout('ls\r\nfile.txt\n[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toBe('ls')
  })

  it('handles ctrl+u (line clear) via multiple backspaces', () => {
    // User types "wrongcmd" then clears with 8 backspaces then types "ls"
    const input = 'wrongcmd' + '\x7f'.repeat(8) + 'ls\r'
    const events: SessionAuditPreviewEvent[] = [
      stdin(input, 1),
      stdout('ls\r\nfile.txt\n[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    expect(commands[0]?.command).toBe('ls')
  })
})

// ─── buildCommandTimeline — real-world JSONL replay ──────────────────────────

describe('buildCommandTimeline — real-world scenario: /var/log audit', () => {
  it('produces clean output for a typical /var/log inspection session', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('cd /var/log\r', 1),
      stdout('[root@localhost log]# ', 2),
      stdin('ls\r', 3),
      stdout(
        'ls\r\n'
        + 'boot.log-20250521  btmp-20260415      cron-20260419  iptraf-ng           maillog-20260419  ntpstats           secure-20260415  spooler-20260419\r\n'
        + '[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r[root@localhost log]# \r\n'
        + '[root@localhost log]#\n[root@localhost log]#\n[root@localhost log]#\n[root@localhost log]#\n[root@localhost log]# [root@localhost log]#',
        4,
      ),
      stdin('less boot.log-20250521\r', 5),
      stdout(
        '\x1b[?1049h\x1b[H\x1b[2J'
        + 'kernel: Boot started\nkernel: Mounting filesystems\nkernel: Network OK\n'
        + 'lines 1-21/21 (END)\x1b>',
        6,
      ),
      stdin('q', 7),
      ended(99),
    ]

    const commands = buildCommandTimeline(events)

    const lsCmd = commands.find(c => c.command === 'ls')
    expect(lsCmd).toBeDefined()
    expect(lsCmd?.output).toContain('boot.log-20250521')
    // No repeated inline prompts
    expect(lsCmd?.output).not.toMatch(/\[root@localhost log\]#.*\[root@localhost log\]#/)

    const lessCmd = commands.find(c => c.command.startsWith('less'))
    expect(lessCmd).toBeDefined()
    expect(lessCmd?.output).not.toContain('lines 1-21/21 (END)')
    expect(lessCmd?.output).not.toContain('\x1b>')
    expect(lessCmd?.output).toContain('Saída interativa contínua detectada')
  })
})

// ─── isLikelyInteractiveCommand — detecção ampliada ──────────────────────────

describe('isLikelyInteractiveCommand', () => {
  // comandos que SÃO interativos
  it.each([
    ['less /var/log/messages'],
    ['more /etc/fstab'],
    ['vim /etc/nginx/nginx.conf'],
    ['vi /etc/hosts'],
    ['nano /tmp/test.txt'],
    ['man ssh'],
    ['top'],
    ['htop'],
    ['watch -n 1 df -h'],
    ['tmux'],
    ['screen'],
    ['journalctl -u nginx'],
    ['journalctl -f'],
    ['journalctl --since today'],
    ['git log'],
    ['git log --oneline'],
    ['git diff HEAD~1'],
    ['git diff --stat'],
    ['git show abc123'],
    ['git blame src/app.ts'],
    ['git shortlog -s'],
    ['tail -f /var/log/syslog'],
    ['tail -fn 100 /var/log/nginx/access.log'],
    ['tail -f -n 50 /var/log/messages'],
    ['grep -r "error" /var/log | less'],
    ['cat /var/log/messages | more'],
    ['ps aux | less'],
  ])('detects "%s" as interactive', (cmd) => {
    expect(isLikelyInteractiveCommand(cmd)).toBe(true)
  })

  // comandos que NÃO são interativos
  it.each([
    ['git status'],
    ['git add .'],
    ['git commit -m "fix"'],
    ['git push origin main'],
    ['git pull'],
    ['git clone https://github.com/foo/bar'],
    ['tail -n 20 /var/log/messages'],
    ['tail -20 /var/log/messages'],
    ['grep "error" /var/log/syslog'],
    ['ls -la'],
    ['cat /etc/hosts'],
    ['ps aux'],
    ['df -h'],
  ])('does not detect "%s" as interactive', (cmd) => {
    expect(isLikelyInteractiveCommand(cmd)).toBe(false)
  })
})

// ─── buildCommandTimeline — journalctl ───────────────────────────────────────

describe('buildCommandTimeline — journalctl', () => {
  it('summarizes journalctl output as interactive', () => {
    const journalOut = Array.from({ length: 50 }, (_, i) =>
      `Apr 26 10:00:${String(i).padStart(2, '0')} localhost sshd[1234]: Accepted publickey for root`,
    ).join('\n') + '\nlines 1-50/50 (END)'

    const events: SessionAuditPreviewEvent[] = [
      stdin('journalctl -u sshd\r', 1),
      stdout(`journalctl -u sshd\r\n${journalOut}`, 2),
      stdin('q', 3),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.startsWith('journalctl'))
    expect(cmd?.confidence).toBe('low')
    expect(cmd?.output).toContain('Saída interativa contínua detectada')
    expect(cmd?.output).not.toContain('lines 1-50/50 (END)')
  })

  it('journalctl -f treated as streaming interactive', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('journalctl -f\r', 1),
      stdout('Apr 26 10:00:01 localhost kernel: eth0 link up\nApr 26 10:00:02 localhost sshd: session opened\n', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.startsWith('journalctl'))
    expect(cmd?.confidence).toBe('low')
    expect(cmd?.output).toContain('Saída interativa contínua detectada')
  })
})

// ─── buildCommandTimeline — git log / git diff ────────────────────────────────

describe('buildCommandTimeline — git log / git diff', () => {
  it('treats git log as interactive', () => {
    const gitLogOut = [
      'commit abc123 (HEAD -> main)',
      'Author: Jeff <jeff@example.com>',
      'Date:   Sat Apr 26 10:00:00 2026',
      '',
      '    feat: add audit normalizer',
      '',
      'commit def456',
      ':',
    ].join('\n')

    const events: SessionAuditPreviewEvent[] = [
      stdin('git log --oneline\r', 1),
      stdout(`git log --oneline\r\n${gitLogOut}`, 2),
      stdin('q', 3),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.startsWith('git log'))
    expect(cmd?.confidence).toBe('low')
    expect(cmd?.output).toContain('Saída interativa contínua detectada')
  })

  it('treats git diff as interactive', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('git diff HEAD~1\r', 1),
      stdout('git diff HEAD~1\r\n\x1b[1mdiff --git a/file.ts b/file.ts\x1b[m\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+new line\n old line\n:', 2),
      stdin('q', 3),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.startsWith('git diff'))
    expect(cmd?.confidence).toBe('low')
    expect(cmd?.output).toContain('Saída interativa contínua detectada')
  })

  it('does NOT treat git status as interactive', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('git status\r', 1),
      stdout('git status\r\nOn branch main\nnothing to commit, working tree clean\n[root@localhost repo]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command === 'git status')
    expect(cmd?.output).not.toContain('Saída interativa contínua detectada')
    expect(cmd?.output).toContain('nothing to commit')
  })
})

// ─── buildCommandTimeline — tail -f ──────────────────────────────────────────

describe('buildCommandTimeline — tail -f', () => {
  it('treats tail -f as interactive streaming', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('tail -f /var/log/nginx/access.log\r', 1),
      stdout(Array.from({ length: 30 }, (_, i) =>
        `192.168.1.${i % 254 + 1} - - [26/Apr/2026] "GET /api HTTP/1.1" 200 512`,
      ).join('\n'), 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.startsWith('tail -f'))
    expect(cmd?.confidence).toBe('low')
    expect(cmd?.output).toContain('Saída interativa contínua detectada')
  })

  it('does NOT treat tail -n 20 as interactive', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('tail -n 20 /var/log/messages\r', 1),
      stdout('tail -n 20 /var/log/messages\r\nline1\nline2\nline3\n[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.startsWith('tail'))
    expect(cmd?.output).not.toContain('Saída interativa contínua detectada')
    expect(cmd?.output).toContain('line1')
  })
})

// ─── buildCommandTimeline — grep | more / grep | less ─────────────────────────

describe('buildCommandTimeline — grep piped to pager', () => {
  it('treats "grep ... | less" as interactive', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('grep -r "ERROR" /var/log | less\r', 1),
      stdout('ERROR: disk full\nERROR: connection refused\nlines 1-2/2 (END)', 2),
      stdin('q', 3),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.includes('grep'))
    expect(cmd?.confidence).toBe('low')
    expect(cmd?.output).toContain('Saída interativa contínua detectada')
    expect(cmd?.output).not.toContain('lines 1-2/2 (END)')
  })

  it('treats "cat ... | more" as interactive', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('cat /var/log/messages | more\r', 1),
      stdout('Jan 1 boot message\nJan 2 another message\n--More--', 2),
      stdin(' ', 3),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.includes('cat'))
    expect(cmd?.confidence).toBe('low')
    expect(cmd?.output).not.toContain('--More--')
  })

  it('does NOT treat plain grep as interactive', () => {
    const events: SessionAuditPreviewEvent[] = [
      stdin('grep root /etc/passwd\r', 1),
      stdout('grep root /etc/passwd\r\nroot:x:0:0:root:/root:/bin/bash\n[root@localhost ~]# ', 2),
      ended(),
    ]
    const commands = buildCommandTimeline(events)
    const cmd = commands.find(c => c.command.startsWith('grep'))
    expect(cmd?.output).not.toContain('Saída interativa contínua detectada')
    expect(cmd?.output).toContain('root:x:0:0')
  })
})
