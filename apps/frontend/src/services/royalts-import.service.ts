import type { HostAccessProtocol } from "@nodeaccess/shared"

export interface RoyalTsHost {
  sourceId: string
  name: string
  ip: string
  port: number
  accessProtocol: HostAccessProtocol
  sshUser: string
  folderPath: string[]
  password?: string
}
export interface RoyalTsImportResult {
  hosts: RoyalTsHost[]
  unsupportedConnections: number
  missingProtocols: number
}
export class RoyalTsImportError extends Error {
  constructor(public readonly code: "format" | "headers" | "csv" | "limit") { super(code) }
}
const ports: Record<string, number> = { ssh: 22, telnet: 23, rdp: 3389, vnc: 5900 }
const normalize = (value: string): string => value.trim().toLowerCase().replace(/[ _-]/g, "")

// Royal TS exports CSV per object type, so not every export contains a protocol.
// Only explicit connection types are mapped; never infer a protocol from a port.
function protocol(value: string): HostAccessProtocol | undefined {
  const key = normalize(value.split(";")[0])
  const types: Record<string, HostAccessProtocol> = {
    ssh: "ssh", telnet: "telnet", rdp: "rdp", vnc: "vnc",
    royalsshconnection: "ssh", royalrdsconnection: "rdp",
    royalterminalservicesconnection: "rdp", royalvncconnection: "vnc",
    remotedesktop: "rdp", remotedesktopconnection: "rdp",
  }
  return Object.hasOwn(types, key) ? types[key] : undefined
}

// RFC-style quoted fields, including delimiters/newlines and escaped double quotes.
function records(content: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = "", quoted = false, closed = false
  const cell = (): void => { row.push(field); field = ""; closed = false; if (row.length > 512) throw new RoyalTsImportError("limit") }
  const record = (): void => { cell(); if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > 5001) throw new RoyalTsImportError("limit") }
  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    if (quoted) {
      if (char === '"') {
        if (content[i + 1] === '"') { field += '"'; i++ } else { quoted = false; closed = true }
      } else field += char
    } else if (char === delimiter) cell()
    else if (char === "\n" || char === "\r") { if (char === "\r" && content[i + 1] === "\n") i++; record() }
    else if (char === '"') { if (field || closed) throw new RoyalTsImportError("csv"); quoted = true }
    else { if (closed) throw new RoyalTsImportError("csv"); field += char }
  }
  if (quoted) throw new RoyalTsImportError("csv")
  if (field || row.length || closed) record()
  return rows
}

function delimiterOf(content: string): string {
  const first = content.split(/\r?\n/, 1)[0]
  // Quotes in a header may surround column names, not delimiters.
  return [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0]
}

export function isRoyalTsCsv(content: string): boolean {
  const sample = content.replace(/^\uFEFF/, "").trimStart().replace(/^sep=[,;\t]\r?\n/i, "")
  const header = sample.split(/\r?\n/, 1)[0].split(delimiterOf(sample)).map(value => normalize(value.replace(/^"|"$/g, "")))
  return header.includes("name") && header.includes("uri")
}

export function parseRoyalTsCsv(content: string, fallbackProtocol?: HostAccessProtocol | null): RoyalTsImportResult {
  const result: RoyalTsImportResult = { hosts: [], unsupportedConnections: 0, missingProtocols: 0 }
  if (content.length > 5 * 1024 * 1024) throw new RoyalTsImportError("limit")
  let normalized = content.replace(/^\uFEFF/, "").trimStart()
  if (!normalized) return result
  if (/^(?:<|PK|\{)/.test(normalized) || normalized.includes("\0")) throw new RoyalTsImportError("format")
  const sep = normalized.match(/^sep=([,;\t])\r?\n/i)
  if (sep) normalized = normalized.slice(sep[0].length)
  const rows = records(normalized, sep?.[1] ?? delimiterOf(normalized))
  const header = (rows.shift() ?? []).map(normalize)
  if (!header.includes("name") || !header.includes("uri") || new Set(header).size !== header.length) throw new RoyalTsImportError("headers")
  for (const [index, row] of rows.entries()) {
    if (row.length !== header.length) throw new RoyalTsImportError("csv")
    const get = (...keys: string[]): string => { for (const key of keys) { const at = header.indexOf(key); if (at >= 0 && row[at].trim()) return row[at].trim() } return "" }
    // ConnectionType distinguishes SSH/Telnet even when both share RoyalSSHConnection.
    const kind = get("connectiontype", "protocol", "objecttype")
    let accessProtocol = kind ? protocol(kind) : fallbackProtocol
    // RDPPort is specific to the Royal RDP object; generic Port is ambiguous.
    if (!kind && !accessProtocol && header.includes("rdpport")) accessProtocol = "rdp"
    if (!accessProtocol) { if (kind) result.unsupportedConnections++; else result.missingProtocols++; continue }
    const rawPort = get(accessProtocol === "rdp" ? "rdpport" : "port", "port")
    const passwordIndex = header.indexOf("password")
    const password = passwordIndex >= 0 ? row[passwordIndex] : ""
    result.hosts.push({
      sourceId: `royalts:${index + 1}`,
      name: get("name"), ip: get("uri"), accessProtocol,
      port: rawPort ? (/^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN) : ports[accessProtocol],
      sshUser: get("username"),
      folderPath: get("folderpath", "parentpath").split(/[\\/]+/).map(part => part.trim()).filter(Boolean),
      ...(password ? { password } : {}),
    })
  }
  return result
}

export async function readSessionImportFile(file: File): Promise<string> {
  // Royal TS/Windows exports can use UTF-16. File.text() always decodes UTF-8.
  const bytes = new Uint8Array(await file.arrayBuffer())
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8"
  return new TextDecoder(encoding, { fatal: true }).decode(bytes)
}
