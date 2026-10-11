import { describe, expect, it } from 'vitest'
import { AuditTextExporter, commandTranscript, terminalTranscript } from './session-audit-text-export.js'
import { reconstructAudit } from './session-audit-reconstruction.js'

function capture(parts: string[], input = 'echo ação\r', cols = 80, rows = 24) {
  const records = [{type:'session_started',payload:{}}, {type:'resize',payload:{cols,rows}},
    {type:'stdin',payload:{data:input}}, ...parts.map(data=>({type:'stdout',payload:{data}})), {type:'session_ended',payload:{}}]
  return reconstructAudit([{seq:1,content:records.map((e,i)=>JSON.stringify({...e,seq:i+1,ts:'2026-09-29T12:00:00Z'})).join('\n')}],'COMPLETED',1)
}
const body=(text:string)=>text.split('\n\n').slice(1).join('\n\n').trimEnd()
describe('readable offline terminal TXT',()=>{
  it('labels an active capture as a partial point-in-time export',async()=>{
    const snapshot=capture(['ok']);snapshot.metadata.state='running'
    expect(await terminalTranscript(42,snapshot)).toContain('Sessão em andamento')
    expect(commandTranscript(42,snapshot)).toContain('Sessão em andamento')
  })
  it('retains the final edited SQL after cursor movement and redraw',async()=>{
    const result=await terminalTranscript(42,capture(['mysql> SELECT 2025;\x1b[2D6\x1b[C\r\n  -> FROM reports;\r\n1 row'], '', 80, 24))
    expect(body(result)).toBe('mysql> SELECT 2026;\n  -> FROM reports;\n1 row')
  })
  it('preserves logical lines when the recorded terminal is resized',async()=>{
    const snapshot=capture(['abcdefghijklmnop','\r\nsegunda linha'], '', 8, 4)
    snapshot.events.splice(4,0,{...snapshot.events[1]!,cols:16,rows:5})
    snapshot.events.forEach((event,index)=>{event.seq=index+1})
    expect(body(await terminalTranscript(42,snapshot))).toBe('abcdefghijklmnop\nsegunda linha')
  })
  it('batches thousands of single-character events with the same result as one chunk',async()=>{
    const text='lab$ echo ação\r\nação\r\n'.repeat(400)
    const fragmented=await terminalTranscript(42,capture([...text]))
    expect(fragmented).toBe(await terminalTranscript(42,capture([text])))
  })
  it('preserves the normal buffer if the session ends inside a full-screen app',async()=>{
    const result=await terminalTranscript(42,capture(['lab$ htop\r\n\x1b[?1049hmetrics']))
    expect(result).toContain('Aplicativo em tela cheia')
    expect(body(result)).toBe('lab$ htop')
  })
  it('rejects oversized readable exports and allows another attempt afterward',async()=>{
    const exporter=new AuditTextExporter(),snapshot=capture(['ok'])
    snapshot.events.find(e=>e.type==='stdout')!.text='x'.repeat(16*1024*1024+1)
    await expect(exporter.export(42,snapshot,'terminal')).rejects.toMatchObject({statusCode:413})
    await expect(exporter.export(42,capture(['ok']),'terminal')).resolves.toContain('ok')
  })
  it('exports the display once, without metadata, stdin duplication or hidden input',async()=>{
    const result=await terminalTranscript(42,capture(['lab$ echo ação\r\nação\r\nlab$ '],'hidden-password\r'))
    expect(body(result)).toBe('lab$ echo ação\nação\nlab$')
    expect(result).not.toMatch(/hidden-password|Processador:|Eventos:|SHA-256|stdout|stdin/)
  })
  it('handles fragmented ANSI, OSC, backspace, cursor editing and erase-in-line',async()=>{
    const result=await terminalTranscript(42,capture(['\x1b[3','1mlab$ echo no','\b\bok\x1b[0m\r\n','progress 10%\rprogress 100%\x1b[K\r\n','\x1b]52;c;secret-clipboard\x07fim']))
    expect(body(result)).toBe('lab$ echo ok\nprogress 100%\nfim')
    expect(result).not.toContain('\x1b')
    expect(result).not.toMatch(/clipboard|<CR>|<BS>/)
  })
  it('preserves Unicode, combining accents, CJK and split surrogate pairs',async()=>{
    const result=await terminalTranscript(42,capture(['ação cafe\u0301 漢字 \ud83d','\ude80\r\n']))
    expect(body(result)).toBe('ação cafe\u0301 漢字 🚀')
    expect(result).not.toContain('�')
  })
  it('joins only soft wraps and preserves SQL newlines and table indentation',async()=>{
    const sql='mysql> SELECT name, total FROM reports;'
    const result=await terminalTranscript(42,capture([sql+'\r\n  -> WHERE total > 2;\r\n+-----+\r\n|  12 |\r\n+-----+'], '', 12, 4))
    expect(body(result)).toBe(sql+'\n  -> WHERE total > 2;\n+-----+\n|  12 |\n+-----+')
  })
  it('keeps long scrollback beyond the emulator buffer without dropping or duplicating rows',async()=>{
    const text=Array.from({length:6000},(_,i)=>`linha-${i}`).join('\r\n')
    const result=await terminalTranscript(42,capture([text], '', 80, 4))
    expect(body(result)).toBe(text.replaceAll('\r\n','\n'))
  })
  it('preserves earlier output across clear screen and scrollback erase',async()=>{
    const result=await terminalTranscript(42,capture(['antes\r\nlab$ clear\r\n\x1b[H\x1b[2J\x1b[3Jdepois\r\n']))
    expect(body(result)).toBe('antes\nlab$ clear\ndepois')
  })
  it('avoids full-screen redraw noise and explicitly directs the user to playback',async()=>{
    const result=await terminalTranscript(42,capture(['lab$ vim arquivo\r\n\x1b[?1049h\x1b[H~\r\n~\x1b[Heditado\x1b[?1049llab$ ']))
    expect(result).toContain('Aplicativo em tela cheia')
    expect(body(result)).toBe('lab$ vim arquivo\nlab$')
    expect(body(result)).not.toContain('editado')
  })
  it('warns about existing replacement characters without inventing a replacement',async()=>{
    const result=await terminalTranscript(42,capture(['a��o']))
    expect(result).toContain('gravação já contém caracteres de substituição')
    expect(body(result)).toBe('a��o')
  })
  it('resets display interpretation across missing events',async()=>{
    const snapshot=capture(['prefix','suffix'])
    snapshot.events.splice(4,1)
    const result=await terminalTranscript(42,snapshot)
    expect(result).toContain('[Trecho ausente na gravação]')
    expect(result).not.toContain('prefixsuffix')
  })
  it('reports missing stdout instead of substituting potentially hidden stdin',async()=>{
    const result=await terminalTranscript(42,capture([],'password\r'))
    expect(result).toContain('Não há saída de terminal registrada')
    expect(result).not.toContain('password')
  })
  it('keeps command-only and technical exports distinct and does not mutate the snapshot',async()=>{
    const snapshot=capture(['lab$ echo ação\r\nação\r\n'])
    const original=JSON.stringify(snapshot)
    const exporter=new AuditTextExporter()
    expect(commandTranscript(42,snapshot)).toContain('echo ação')
    expect(commandTranscript(42,snapshot)).not.toContain('SAÍDA ASSOCIADA')
    expect(await exporter.export(42,snapshot,'technical')).toContain('EVENTOS VÁLIDOS')
    await exporter.export(42,snapshot,'terminal')
    expect(JSON.stringify(snapshot)).toBe(original)
  })
  it('bounds simultaneous exports and releases slots after completion',async()=>{
    const exporter=new AuditTextExporter(),snapshot=capture(['ok'])
    const first=exporter.export(42,snapshot,'terminal'),second=exporter.export(43,snapshot,'terminal')
    await expect(exporter.export(44,snapshot,'terminal')).rejects.toMatchObject({statusCode:503})
    await Promise.all([first,second])
    await expect(exporter.export(44,snapshot,'terminal')).resolves.toContain('ok')
  })
})
