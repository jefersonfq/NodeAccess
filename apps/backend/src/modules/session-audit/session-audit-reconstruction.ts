import { createHash } from 'node:crypto'
import { SessionAuditPreviewEventSchema, type SessionAuditCommand, type SessionAuditPreviewEvent, type SessionAuditReconstruction } from '@nodeaccess/shared'
import { buildCommandTimeline, parsePreviewLine } from './session-audit-normalizer.js'

export const AUDIT_PROCESSOR_VERSION = 'ssh-readline-2026-09-29.2'
export interface AuditChunkInput { seq: number; content: string; unavailable?: boolean }
export interface AuditSnapshot {
  metadata: SessionAuditReconstruction
  commands: SessionAuditCommand[]
  events: SessionAuditPreviewEvent[]
}

/** Derivation only. Original chunks are never modified. Gaps break parser state. */
export function reconstructAudit(chunks: AuditChunkInput[], status: string, expectedChunks: number, now = new Date()): AuditSnapshot {
  const events: SessionAuditPreviewEvent[] = []
  const segments: SessionAuditPreviewEvent[][] = [[]]
  const issues: SessionAuditReconstruction['issues'] = []
  const fingerprint = createHash('sha256').update(JSON.stringify([status, expectedChunks]))
  let lastSeq = 0, lastChunk = 0
  const issue = (value: SessionAuditReconstruction['issues'][number]): void => {
    // Bound diagnostics for corrupt files; retain a summary if the limit is reached.
    if (issues.length < 100) issues.push(value)
    else if (issues.length === 100) issues.push({code:'MORE_ISSUES',message:'Há outras inconsistências no registro; revise o arquivo bruto.'})
    if (segments.at(-1)!.length) segments.push([])
  }
  if (chunks.length !== expectedChunks) issue({code:'CHUNK_COUNT',message:'A quantidade de partes disponíveis difere do registro da sessão.'})
  for (const chunk of chunks) {
    fingerprint.update(JSON.stringify([chunk.seq, chunk.content.length, !!chunk.unavailable])).update(chunk.content)
    if (chunk.seq !== lastChunk + 1) issue({code:'CHUNK_SEQUENCE',message:'Sequência de partes ausente ou fora de ordem.',chunkSeq:chunk.seq})
    lastChunk = chunk.seq
    if (chunk.unavailable || !chunk.content.trim()) { issue({code:'CHUNK_UNAVAILABLE',message:'Uma parte da gravação está indisponível ou vazia.',chunkSeq:chunk.seq}); continue }
    for (const line of chunk.content.split('\n')) {
      if (!line.trim()) continue
      const parsed = parsePreviewLine(line)
      if (!parsed || !SessionAuditPreviewEventSchema.safeParse(parsed).success || !Number.isFinite(Date.parse(parsed.timestamp))) {
        issue({code:'INVALID_EVENT',message:'Um evento não pôde ser interpretado.',chunkSeq:chunk.seq}); continue
      }
      if (parsed.seq !== lastSeq + 1) issue({code:parsed.seq <= lastSeq ? 'EVENT_ORDER' : 'EVENT_GAP',message:'Há eventos ausentes, repetidos ou fora de ordem.',fromSeq:lastSeq + 1,toSeq:parsed.seq})
      if (parsed.seq <= lastSeq) continue // Do not execute the same recorded input twice.
      lastSeq = parsed.seq
      events.push(parsed); segments.at(-1)!.push(parsed)
    }
  }
  if (!events.some(e=>e.type==='session_started')) issue({code:'MISSING_START',message:'O início da gravação não está disponível.'})
  if (status !== 'RUNNING' && !events.some(e=>e.type==='session_ended' || e.type==='session_error')) issue({code:'MISSING_END',message:'O encerramento da gravação não está disponível.'})
  const commands = segments.flatMap(segment=>buildCommandTimeline(segment,{provenance:true})).map((command,index)=>({
    ...command,index:index+1,processorVersion:AUDIT_PROCESSOR_VERSION,
    ...(issues.length ? {confidence:'low' as const,reconstructionWarnings:[...(command.reconstructionWarnings ?? []),'A gravação apresenta lacunas; este comando pode estar incompleto. Confira os eventos originais.']} : {}),
  }))
  const sourceFingerprint = fingerprint.digest('hex')
  return {events,commands,metadata:{id:createHash('sha256').update(AUDIT_PROCESSOR_VERSION+sourceFingerprint).digest('hex'),processorVersion:AUDIT_PROCESSOR_VERSION,sourceFingerprint,createdAt:now.toISOString(),verifiedAt:now.toISOString(),state:events.length===0?'unavailable':issues.length?'partial':status==='RUNNING'?'running':'complete',eventCount:events.length,commandCount:commands.length,persisted:false,issues}}
}

/** Printable representation: TXT must not execute terminal escape sequences. */
export function printableAuditText(text: string): string {
  return [...text].map(char=>{
    const code=char.codePointAt(0)!
    if (char==='\n' || char==='\t' || (code>=32 && code!==127 && !(code>=0x80&&code<=0x9f) && !(code>=0x202a&&code<=0x202e) && !(code>=0x2066&&code<=0x2069))) return char
    return ({13:'<CR>',8:'<BS>',27:'<ESC>',127:'<DEL>'} as Record<number,string>)[code] ?? `<U+${code.toString(16).toUpperCase().padStart(4,'0')}>`
  }).join('')
}
export function auditTranscript(sessionId: number, snapshot: AuditSnapshot): string {
  const {metadata,commands,events}=snapshot
  const parts=[`NodeAccess — Transcrição da auditoria #${sessionId}`,`Processador: ${metadata.processorVersion}`,`Reconstrução: ${metadata.id}`,`SHA-256 da fonte observada: ${metadata.sourceFingerprint}`,`Versão criada em: ${metadata.createdAt}`,`Fonte verificada em: ${metadata.verifiedAt ?? metadata.createdAt}`,`Estado: ${metadata.state}`,
    'Documento derivado; não substitui o JSONL original. Entrada enviada não significa execução bem-sucedida.',
    'O mascaramento é o da gravação original. Controles são representados entre < >, sem execução.',
    ...metadata.issues.map(i=>`AVISO [${i.code}]: ${i.message}`),'','=== COMANDOS RECONSTRUÍDOS ===']
  for(const c of commands) parts.push(`\n#${c.index} | ${c.submittedAt} | autor=${c.actorUserId ?? 'não identificado'} | confiança=${c.confidence}`,`Eventos: ${JSON.stringify(c.source ?? {})}`,printableAuditText(c.command),...(c.reconstructionWarnings??[]).map(w=>`AVISO: ${w}`),'SAÍDA ASSOCIADA:',printableAuditText(c.output))
  parts.push('\n=== EVENTOS VÁLIDOS DA GRAVAÇÃO EM ORDEM ===')
  for(const e of events)parts.push(`[${e.seq} | ${e.timestamp} | ${e.type} | autor=${e.actorUserId ?? 'não identificado'}${e.type==='resize'?` | ${e.cols}x${e.rows}`:''}]`,printableAuditText(e.text??''))
  return parts.join('\n')+'\n'
}
