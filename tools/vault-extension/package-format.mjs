/**
 * NA-0194 — release formats of the VaultNAccess extension, with node:zlib/node:crypto only (no dependency):
 * reproducible ZIP (sorted entries, fixed timestamp), CRX3 signed with RSA-SHA256 (Chromium's public format),
 * extension id derived from the signing key, and the gupdate manifest for policy-installed copies.
 */
import { createHash, createPublicKey, sign } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** `files`: [{ name, data }]; names use "/" and are written in byte order with the DOS date 1980-01-01 00:00. */
export function zip(files) {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
  const locals = [], centrals = []
  let offset = 0
  for (const { name, data } of sorted) {
    if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`Invalid entry name: ${name}`)
    const nameBytes = Buffer.from(name, 'utf8'), compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, compressed); centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + compressed.length
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(sorted.length, 8); end.writeUInt16LE(sorted.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function varint(value) {
  const bytes = []
  let v = value
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v = Math.floor(v / 128) }
  bytes.push(v)
  return Buffer.from(bytes)
}
const field = (number, payload) => Buffer.concat([varint(number * 8 + 2), varint(payload.length), payload])

/** RSA public key (SPKI DER) of a private key; only RSA ≥ 2048 bits is accepted for release signing. */
export function publicKeyDer(privateKey) {
  if (privateKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('The signing key must be RSA with at least 2048 bits')
  return createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
}
/** Chromium extension id: first 16 bytes of SHA-256(SPKI) written with the letters a–p. */
export function extensionId(spki) {
  return [...createHash('sha256').update(spki).digest().subarray(0, 16)].map(byte => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join('')
}
/** CRX3: "Cr24", version 3, CrxFileHeader { sha256_with_rsa: { public_key, signature }, signed_header_data: SignedData { crx_id } }. */
export function crx3(archive, privateKey) {
  const spki = publicKeyDer(privateKey)
  const signedHeaderData = field(1, createHash('sha256').update(spki).digest().subarray(0, 16))
  const size = Buffer.alloc(4); size.writeUInt32LE(signedHeaderData.length, 0)
  const signature = sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'binary'), size, signedHeaderData, archive]), privateKey)
  const header = Buffer.concat([field(2, Buffer.concat([field(1, spki), field(2, signature)])), field(10000, signedHeaderData)])
  const prefix = Buffer.alloc(12)
  prefix.write('Cr24', 0, 'binary'); prefix.writeUInt32LE(3, 4); prefix.writeUInt32LE(header.length, 8)
  return Buffer.concat([prefix, header, archive])
}
const xml = value => String(value).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
export function updateManifest(id, version, codebase) {
  if (!/^[a-p]{32}$/.test(id) || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) || !codebase.startsWith('https://')) throw new Error('Invalid update manifest input')
  return `<?xml version='1.0' encoding='UTF-8'?>\n<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n  <app appid='${xml(id)}'>\n    <updatecheck codebase='${xml(codebase)}' version='${xml(version)}' />\n  </app>\n</gupdate>\n`
}
