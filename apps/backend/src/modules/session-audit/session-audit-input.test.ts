import { describe, expect, it } from 'vitest'
import { AuditInputReconstructor } from './session-audit-input.js'

function mysql() { const input = new AuditInputReconstructor(); input.setMysql(true); return input }
describe('offline audit input fidelity', () => {
  it('reconstructs paste, cursor edits and Unicode at every possible transport split', () => {
    const raw = "\x1b[200~SELECT 'ação 😀',\r\n100;\x1b[201~\x1b[D\x7f1\x1b[F\r\n"
    for (let split = 0; split <= raw.length; split++) {
      const input = mysql()
      const result = [...input.feed(raw.slice(0, split), 9), ...input.feed(raw.slice(split), 9)]
      expect(result.map(r => r.command), `split=${split}`).toEqual(["SELECT 'ação 😀',\n101;"])
      expect(result[0]?.uncertain).toBe(false)
    }
  })
  it.each([
    ['SELECT 100;\x1b[2D\x1b[3~1\r', 'SELECT 101;'],
    ['SELECT 100;\x01\x1b[7C\x0b101;\r', 'SELECT 101;'],
    ['discard\x15SELECT 101;\r', 'SELECT 101;'],
    ['SELECT 100\x17\x191;\r', 'SELECT 1001;'],
    ['SELECT 101;\x1bOH\x1bOF\r', 'SELECT 101;'],
  ])('supports line editing %j', (raw, expected) => {
    expect(mysql().feed(raw, 9).map(r => r.command)).toEqual([expected])
  })
  it('does not mistake quoted or commented terminators for execution', () => {
    const input = mysql()
    expect(input.feed("SELECT 'a;''b', `x;y`,\r\n", 9)).toEqual([])
    expect(input.feed('/* ; */ 1 -- ;\r\n', 9)).toEqual([])
    expect(input.feed('FROM reports;\r', 9)[0]?.command).toBe("SELECT 'a;''b', `x;y`,\n/* ; */ 1 -- ;\nFROM reports;")
  })
  it('handles custom delimiters and restores the default delimiter', () => {
    const input = mysql()
    expect(input.feed('DELIMITER $$\r', 9)[0]?.command).toBe('DELIMITER $$')
    expect(input.feed('CREATE PROCEDURE p()\rBEGIN\rSELECT 1;\r', 9)).toEqual([])
    expect(input.feed('END$$\r', 9)[0]?.command).toBe('CREATE PROCEDURE p()\nBEGIN\nSELECT 1;\nEND$$')
    expect(input.feed('DELIMITER ;\rSELECT 2;\r', 9).map(r => r.command)).toEqual(['DELIMITER ;', 'SELECT 2;'])
  })
  it('keeps unfinished statements out of an executed pasted batch', () => {
    const input = mysql()
    expect(input.feed('\x1b[200~SELECT 1;\nSELECT pending\x1b[201~\r', 9).map(r => r.command)).toEqual(['SELECT 1;'])
    expect(input.feed('FROM reports;\r', 9)[0]?.command).toBe('SELECT pending\nFROM reports;')
  })
  it('cancels input on Ctrl+C without leaking canceled text into the next command', () => {
    const input = mysql()
    expect(input.feed('SELECT unfinished\rmore\x03SELECT 2;\r', 9).map(r => r.command)).toEqual(['SELECT 2;'])
  })
  it('marks unsupported history edits and mixed actors as uncertain', () => {
    const input = mysql()
    input.feed('SELECT ', 9)
    expect(input.feed('1;\x1b[A\r', 10)[0]).toMatchObject({ uncertain: true, actorUserId: 10 })
    expect(input.feed('SELECT 2;\r', 10)[0]?.uncertain).toBe(false)
  })
  it('preserves a large SQL report without truncation', () => {
    const sql = `SELECT '${'relatório  '.repeat(10000)}';`
    expect(mysql().feed(`\x1b[200~${sql}\x1b[201~\r`, 9)[0]?.command).toBe(sql)
  })
})

describe('server-observed history redraw', () => {
  it('restores and edits the actual server history entry', () => {
    const input = mysql()
    input.feed('\x1b[A', 9)
    input.observeOutput('SELECT 100;', 80, 7)
    expect(input.feed('\x1b[D\x7f1\r', 9)[0]).toMatchObject({command:'SELECT 101;', uncertain:false})
  })
  it('accepts fragmented column positioning and erasure when switching history entries', () => {
    const input = mysql()
    input.feed('\x1b[A', 9)
    input.observeOutput('SELECT 100;', 80, 7)
    input.feed('\x1b[A', 9)
    for(const chunk of ['\x1b[','8G','SELECT 2;','\x1b[','K'])input.observeOutput(chunk,80,7)
    expect(input.feed('\r',9)[0]).toMatchObject({command:'SELECT 2;',uncertain:false})
  })
  it('removes only the extra space of a verified readline soft wrap', () => {
    const input = mysql()
    input.feed('\x1b[A',9)
    input.observeOutput("SELECT '12345 \r67890123456789012345 \r6789';",20,7)
    expect(input.feed('\r',9)[0]).toMatchObject({command:"SELECT '12345678901234567890123456789';",uncertain:false})
  })
  it('does not trust output with unsupported screen manipulation', () => {
    const input = mysql()
    input.feed('SELECT 1;\x1b[A',9)
    input.observeOutput('\x1b[2JSELECT 2;',80,7)
    expect(input.feed('\r',9)[0]).toMatchObject({command:'SELECT 1;',uncertain:true})
  })
  it('restores an empty line without carrying a recalled command into new input', () => {
    const input=mysql()
    input.feed('\x1b[A',9)
    input.observeOutput('SELECT 1;',80,7)
    input.feed('\x1b[B',9)
    input.observeOutput('\x1b[8G\x1b[K',80,7)
    expect(input.feed('SELECT 2;\r',9)[0]).toMatchObject({command:'SELECT 2;',uncertain:false})
  })
})

describe('modified arrows with observed server binding',()=>{
 it('uses an explicit server insert instead of assuming Shift+Right moves the cursor',()=>{
  const input=mysql()
  input.feed('SELECT 1;\x1b[D\x1b[1;2C',9)
  input.observeOutput('\x07',80,7)
  input.observeOutput('\x1b[1@C\x1b[12G',80,7)
  expect(input.feed('\x7f2\r',9)[0]).toMatchObject({command:'SELECT 12;',uncertain:false})
 })
 it('marks an unobserved modified arrow as uncertain',()=>{
  expect(mysql().feed('SELECT 1;\x1b[1;2C\r',9)[0]).toMatchObject({uncertain:true})
 })
 it('keeps a known line unchanged when the server only rings the bell',()=>{
  const input=mysql()
  input.feed('SELECT 1;\x1b[1;2C',9)
  input.observeOutput('\x07',80,7)
  expect(input.feed('\r',9)[0]).toMatchObject({command:'SELECT 1;',uncertain:false})
 })
})

describe('SQL tab fidelity',()=>{
 it('distinguishes literal paste indentation from unverified interactive completion',()=>{
  expect(mysql().feed('\x1b[200~SELECT\t1;\x1b[201~\r',9)[0]).toMatchObject({command:'SELECT\t1;',uncertain:false})
  expect(mysql().feed('SELECT ta\t;\r',9)[0]?.uncertain).toBe(true)
 })
})
