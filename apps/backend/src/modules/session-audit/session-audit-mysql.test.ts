import { describe, expect, it } from 'vitest'
import { buildCommandTimeline } from './session-audit-normalizer.js'
import type { SessionAuditPreviewEvent } from '@nodeaccess/shared'
const base = Date.parse('2026-09-28T10:00:00Z')
function fixture() {
  const events: SessionAuditPreviewEvent[] = []
  const push = (type: SessionAuditPreviewEvent['type'], text: string) => events.push({ seq: events.length + 1, timestamp: new Date(base + events.length * 100).toISOString(), type, text, actorUserId: type === 'stdin' ? 9 : null, bytes: Buffer.byteLength(text), cols: null, rows: null })
  push('stdout', '[audit@lab ~]$ ')
  for (const command of ['pwd', 'whoami', 'date', 'hostname', 'mysql reporting']) {
    push('stdin', command + '\r')
    push('stdout', command + '\r\n' + (command.startsWith('mysql') ? 'Welcome to the MySQL monitor.\r\nmysql> ' : 'ok\r\n[audit@lab ~]$ '))
  }
  return { events, push }
}
describe('SQL pasted and edited in the MySQL CLI', () => {
  it('keeps cursor edits instead of appending replacement text at the end', () => {
    const { events, push } = fixture()
    push('stdin', "SELECT 100;\x1b[D\x7f1\x1b[F\r")
    push('stdout', 'SELECT 101;\r\n101\r\nmysql> ')
    push('session_ended', '')
    expect(buildCommandTimeline(events).map(c => c.command)).toEqual(['pwd','whoami','date','hostname','mysql reporting','SELECT 101;'])
  })
  it('preserves a multiline pasted SQL and whitespace inside its literals', () => {
    const { events, push } = fixture()
    const sql = "SELECT 'Algar  relatório',\n       customer_id\nFROM reports\nWHERE note = 'a;b';"
    push('stdin', '\x1b[200~' + sql + '\x1b[201~\r')
    push('stdout', 'rows\r\nmysql> ')
    push('session_ended', '')
    expect(buildCommandTimeline(events).at(-1)?.command).toBe(sql)
  })
  it('joins MySQL continuation lines until a terminator outside quotes', () => {
    const { events, push } = fixture()
    push('stdin', "SELECT 'a;b',\r")
    push('stdout', "SELECT 'a;b',\r\n    -> ")
    push('stdin', ' customer_id\r')
    push('stdout', ' customer_id\r\n    -> ')
    push('stdin', 'FROM reports\\G\r')
    push('stdout', 'row\r\nmysql> ')
    push('session_ended', '')
    expect(buildCommandTimeline(events).at(-1)?.command).toBe("SELECT 'a;b',\n customer_id\nFROM reports\\G")
  })
  it('does not report canceled or unfinished SQL as executed', () => {
    const { events, push } = fixture()
    push('stdin', 'SELECT secret_column FROM accounts\r')
    push('stdout', '    -> ')
    push('stdin', '\\c\r')
    push('stdout', 'mysql> ')
    push('stdin', 'SELECT unfinished\r')
    push('session_ended', '')
    expect(buildCommandTimeline(events).map(c => c.command)).toEqual(['pwd','whoami','date','hostname','mysql reporting'])
  })
})

describe('audited client boundaries', () => {
  it('separates OpenSIPS CLI command output at its observed prompt', () => {
    const {events,push}=fixture()
    push('stdin','quit\r')
    push('stdout','Bye\r\n[audit@lab ~]$ ')
    push('stdin','opensips-cli\r')
    push('stdout','Welcome\r\n(opensips-cli): ')
    push('stdin','mi which\r')
    push('stdout','which-result\r\n(opensips-cli): ')
    push('stdin','mi uptime\r')
    push('stdout','uptime-result\r\n(opensips-cli): ')
    push('session_ended','')
    const commands=buildCommandTimeline(events)
    expect(commands.at(-2)).toMatchObject({command:'mi which',output:'which-result'})
    expect(commands.at(-1)).toMatchObject({command:'mi uptime',output:'uptime-result'})
    expect(commands.at(-3)?.output).not.toContain('which-result')
  })
  it('supports MariaDB continuation prompts and returns to normal shell parsing', () => {
    const {events,push}=fixture()
    push('stdout','MariaDB [reports]> ')
    push('stdin','SELECT 1\r')
    push('stdout','\r\n    -> ')
    push('stdin',';\r')
    push('stdout','1 row\r\nMariaDB [reports]> ')
    push('stdin','quit\r')
    push('stdout','Bye\r\n[audit@lab ~]$ ')
    push('stdin','whoami\r')
    push('stdout','audit\r\n[audit@lab ~]$ ')
    push('session_ended','')
    expect(buildCommandTimeline(events).slice(-3).map(c=>c.command)).toEqual(['SELECT 1\n;','quit','whoami'])
  })
  it('exposes uncertainty rather than certifying a partially known command', () => {
    const {events,push}=fixture()
    push('stdin','SELECT 1;\x1b[A\r')
    push('stdout','unknown history result\r\nmysql> ')
    push('session_ended','')
    expect(buildCommandTimeline(events).at(-1)).toMatchObject({confidence:'low', reconstructionWarnings:[expect.stringContaining('playback')]})
  })
})
