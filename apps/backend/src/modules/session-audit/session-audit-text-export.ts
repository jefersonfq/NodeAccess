import headless from '@xterm/headless'
import type { IMarker, IBufferLine } from '@xterm/headless'
import { AppError } from '../../shared/errors.js'
import { auditTranscript, printableAuditText, type AuditSnapshot } from './session-audit-reconstruction.js'

export type AuditTextFormat = 'terminal' | 'commands' | 'technical'
const { Terminal } = headless
const MAX_TEXT = 16 * 1024 * 1024
function lineText(line: IBufferLine, continued: boolean): string {
  if (!continued) return line.translateToString(true)
  // Resize can pad a wrapped row with empty cells. Preserve actual spaces (32),
  // but do not insert those empty cells (0) into the logical command/SQL.
  let end = line.length
  while (end > 0 && line.getCell(end - 1)?.getCode() === 0 && line.getCell(end - 1)?.getWidth() !== 0) end--
  return line.translateToString(false, 0, end)
}

/** Offline presentation only: never feeds stdin, sends terminal replies or changes the command parser. */
export async function terminalTranscript(sessionId: number, snapshot: AuditSnapshot): Promise<string> {
  const notices = new Set(snapshot.metadata.issues.map(i => i.message))
  if (snapshot.metadata.state === 'running') notices.add('Sessão em andamento; este arquivo contém somente o trecho disponível no momento da exportação.')
  if (!snapshot.events.some(e => e.type === 'resize' && e.cols && e.rows)) notices.add('Dimensões não registradas; layout estimado em 80 × 24 colunas/linhas.')
  const term = new Terminal({ cols: 80, rows: 24, scrollback: 4096, allowProposedApi: true, logLevel: 'off' })
  let marker: IMarker | undefined = term.registerMarker(0)
  let resetAnchor = false, size = 0, sourceSize = 0, lastSeq = 0
  const lines: string[] = []
  const append = (text: string, wrapped: boolean): void => {
    const safe = printableAuditText(text)
    size += Buffer.byteLength(safe) + 1
    if (size > MAX_TEXT) throw new AppError('O TXT excede o limite de exportação. Baixe o JSONL original.', 413, 'AUDIT_TEXT_TOO_LARGE')
    if (wrapped && lines.length) lines[lines.length - 1] += safe
    else lines.push(safe)
  }
  const anchor = (line: number): void => {
    marker?.dispose()
    marker = term.registerMarker(line - term.buffer.normal.baseY - term.buffer.normal.cursorY)
  }
  const drain = (full = false): void => {
    if (term.buffer.active.type !== 'normal') return
    const buffer = term.buffer.normal
    if (resetAnchor) { anchor(buffer.baseY); resetAnchor = false }
    if (!marker || marker.isDisposed) throw new AppError('O limite de linhas do TXT foi atingido. Baixe o JSONL original.', 413, 'AUDIT_TEXT_BUFFER_LIMIT')
    let end = buffer.baseY
    if (full) {
      end = buffer.length
      while (end > marker.line && !buffer.getLine(end - 1)?.translateToString(true)) end--
    }
    for (let y = marker.line; y < end; y++) {
      const line = buffer.getLine(y)!
      // Preserve spaces at physical wraps; trim padding only at logical line ends.
      append(lineText(line, !!buffer.getLine(y + 1)?.isWrapped), line.isWrapped)
    }
    anchor(end)
  }
  term.buffer.onBufferChange(buffer => {
    if (buffer.type === 'alternate') notices.add('Aplicativo em tela cheia: consulte o playback para visualizar seu conteúdo e suas alterações.')
  })
  let handlerError: Error | undefined
  // xterm catches parser handler exceptions. Capture failures explicitly and fail the download.
  const write = async (text: string): Promise<void> => {
    for (let offset = 0; offset < text.length; offset += 2048) {
      await new Promise<void>(resolve => term.write(text.slice(offset, offset + 2048), resolve))
      if (handlerError) throw handlerError
      drain()
    }
  }
  // Wrap parser callbacks through the public API to propagate export-limit failures.
  const guardedDrain = (full: boolean): void => { try { drain(full) } catch (error) { handlerError = error instanceof Error ? error : new Error(String(error)) } }
  term.parser.registerEscHandler({ final: 'c' }, () => { guardedDrain(true); resetAnchor = true; return false })
  term.parser.registerCsiHandler({ final: 'J' }, params => {
    if (term.buffer.active.type === 'normal' && [2, 3].includes(Number(params[0]))) {
      guardedDrain(Number(params[0]) === 2); resetAnchor = true
    }
    return false
  })
  try {
    let pendingText = ''
    const flushText = async (): Promise<void> => { if (pendingText) { await write(pendingText); pendingText = '' } }
    for (const event of snapshot.events) {
      if (lastSeq && event.seq !== lastSeq + 1) {
        await flushText()
        drain(true); term.reset(); anchor(0); resetAnchor = false
        append('[Trecho ausente na gravação]', false)
      }
      lastSeq = event.seq
      if (event.type === 'resize' && event.cols && event.rows) {
        await flushText()
        if (event.cols > 512 || event.rows > 200) notices.add('Dimensões do terminal limitadas na exportação; consulte o playback para o layout original.')
        term.resize(Math.min(event.cols, 512), Math.min(event.rows, 200))
        drain()
      }
      if (event.type !== 'stdout' || !event.text) continue
      sourceSize += Buffer.byteLength(event.text)
      if (sourceSize > MAX_TEXT) throw new AppError('A sessão excede o limite do TXT legível. Baixe o JSONL original.', 413, 'AUDIT_TEXT_TOO_LARGE')
      if (event.text.includes('\uFFFD')) notices.add('A gravação já contém caracteres de substituição (�); a exportação não consegue recuperar os bytes originais.')
      pendingText += event.text
      if (pendingText.length >= 16384) await flushText()
    }
    await flushText()
    if (term.buffer.active.type === 'alternate') {
      // Normal buffer remains readable, but its markers cannot be updated while alternate is active.
      const buffer = term.buffer.normal
      if (marker && !marker.isDisposed) for (let y = marker.line; y < buffer.length; y++) {
        const line = buffer.getLine(y)!
        append(lineText(line, !!buffer.getLine(y + 1)?.isWrapped), line.isWrapped)
      }
    } else drain(true)
    while (lines.length && lines.at(-1) === '') lines.pop()
    const body = lines.join('\n') || '[Não há saída de terminal registrada.]'
    return [`NodeAccess — Sessão #${sessionId}`, ...[...notices].map(n => `Aviso: ${n}`), '', body, ''].join('\n')
  } finally { marker?.dispose(); term.dispose() }
}

export function commandTranscript(sessionId: number, snapshot: AuditSnapshot): string {
  const warnings = new Set([...snapshot.metadata.issues.map(i => i.message), ...snapshot.commands.flatMap(c => c.reconstructionWarnings ?? [])])
  if (snapshot.metadata.state === 'running') warnings.add('Sessão em andamento; a lista de comandos ainda pode mudar.')
  return [`NodeAccess — Comandos reconstruídos da sessão #${sessionId}`,
    'Entradas reconstruídas; não comprovam execução bem-sucedida.',
    ...[...warnings].map(w => `Aviso: ${w}`), '',
    snapshot.commands.map(c => printableAuditText(c.command)).join('\n\n'), ''].join('\n')
}

/** Export concurrency is independent of reconstruction cache hits. No long-lived TXT cache. */
export class AuditTextExporter {
  private active = 0
  async export(sessionId: number, snapshot: AuditSnapshot, format: AuditTextFormat): Promise<string> {
    if (this.active >= 2) throw new AppError('Há exportações em andamento. Tente novamente em instantes.', 503, 'AUDIT_EXPORT_BUSY')
    this.active++
    try {
      if (format === 'technical') return auditTranscript(sessionId, snapshot)
      if (format === 'commands') return commandTranscript(sessionId, snapshot)
      return await terminalTranscript(sessionId, snapshot)
    } finally { this.active-- }
  }
}
