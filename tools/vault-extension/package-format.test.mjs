import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { crc32, crx3, extensionId, publicKeyDer, updateManifest, zip } from './package-format.mjs'

// Independent reader (written from Chromium's crx3.proto), used for our CRX and for one packed by Chromium itself.
function readVarint(buffer, offset) {
  let value = 0, shift = 0, at = offset
  for (;;) { const byte = buffer[at++]; value += (byte & 0x7f) * 2 ** shift; if (!(byte & 0x80)) return [value, at]; shift += 7 }
}
function fields(buffer) {
  const out = []
  let at = 0
  while (at < buffer.length) {
    const [tag, next] = readVarint(buffer, at); const [length, start] = readVarint(buffer, next)
    out.push({ number: Math.floor(tag / 8), wire: tag % 8, value: buffer.subarray(start, start + length) }); at = start + length
  }
  return out
}
export function readCrx3(crx) {
  assert.equal(crx.subarray(0, 4).toString('binary'), 'Cr24'); assert.equal(crx.readUInt32LE(4), 3)
  const headerSize = crx.readUInt32LE(8), header = crx.subarray(12, 12 + headerSize), archive = crx.subarray(12 + headerSize)
  const top = fields(header)
  const signed = top.find(f => f.number === 10000).value
  const crxId = fields(signed).find(f => f.number === 1).value
  const proofs = top.filter(f => f.number === 2).map(f => fields(f.value)).map(p => ({ key: p.find(f => f.number === 1).value, signature: p.find(f => f.number === 2).value }))
  const size = Buffer.alloc(4); size.writeUInt32LE(signed.length, 0)
  const message = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'binary'), size, signed, archive])
  const valid = proofs.some(p => verify('sha256', message, createPublicKey({ key: p.key, format: 'der', type: 'spki' }), p.signature)
    && createHash('sha256').update(p.key).digest().subarray(0, 16).equals(crxId))
  const id = [...crxId].map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('')
  return { id, valid, archive }
}
function unzipNames(archive) {
  const names = []
  let at = 0
  while (archive.readUInt32LE(at) === 0x04034b50) {
    const size = archive.readUInt32LE(at + 18), nameLength = archive.readUInt16LE(at + 26), extra = archive.readUInt16LE(at + 28)
    const name = archive.subarray(at + 30, at + 30 + nameLength).toString('utf8'), data = archive.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size)
    names.push({ name, data: inflateRawSync(data), crc: archive.readUInt32LE(at + 14) }); at += 30 + nameLength + extra + size
  }
  return names
}
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

test('NA-0194: reproducible ZIP with sorted entries, valid CRCs and content', () => {
  const files = [{ name: 'popup.html', data: Buffer.from('<html>') }, { name: 'icons/a.png', data: Buffer.alloc(100, 7) }, { name: 'manifest.json', data: Buffer.from('{}') }]
  const first = zip(files), second = zip([...files].reverse())
  assert.ok(first.equals(second))
  const entries = unzipNames(first)
  assert.deepEqual(entries.map(e => e.name), ['icons/a.png', 'manifest.json', 'popup.html'])
  for (const e of entries) assert.equal(e.crc, crc32(e.data))
  assert.equal(entries[2].data.toString(), '<html>')
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  for (const bad of ['', '/abs', 'a/../b']) assert.throws(() => zip([{ name: bad, data: Buffer.alloc(1) }]))
})

test('NA-0194: CRX3 signature and id verify with an independent reader', () => {
  const archive = zip([{ name: 'manifest.json', data: Buffer.from('{"manifest_version":3}') }])
  const parsed = readCrx3(crx3(archive, privateKey))
  assert.equal(parsed.valid, true)
  assert.equal(parsed.id, extensionId(publicKeyDer(privateKey)))
  assert.ok(parsed.archive.equals(archive))
  const tampered = crx3(archive, privateKey); tampered[tampered.length - 30] ^= 1
  assert.equal(readCrx3(tampered).valid, false)
  assert.throws(() => publicKeyDer(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey), /RSA/)
  assert.throws(() => publicKeyDer(generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey), /2048/)
})

test('NA-0194: the reader agrees with a CRX packed by Chromium itself (when available locally)', { skip: !process.env.CHROMIUM_CRX_SAMPLE || !existsSync(process.env.CHROMIUM_CRX_SAMPLE) }, () => {
  const sample = readCrx3(readFileSync(process.env.CHROMIUM_CRX_SAMPLE))
  assert.equal(sample.valid, true)
  if (process.env.CHROMIUM_CRX_EXPECTED_ID) assert.equal(sample.id, process.env.CHROMIUM_CRX_EXPECTED_ID)
})

test('NA-0194: update manifest is well formed and escapes values', () => {
  const xml = updateManifest('a'.repeat(32), '1.2.3', "https://portal.test/x?a=1&b='2'")
  assert.match(xml, /<app appid='a{32}'>/); assert.match(xml, /version='1\.2\.3'/); assert.match(xml, /a=1&amp;b=&apos;2&apos;/)
  for (const args of [['x', '1.2.3', 'https://p'], ['a'.repeat(32), '1.2', 'https://p'], ['a'.repeat(32), '1.2.3', 'http://p']]) assert.throws(() => updateManifest(...args))
})

test('NA-0194: extension id is the a–p rendering of SHA-256(SPKI)[0..16]', () => {
  const spki = publicKeyDer(privateKey)
  const id = extensionId(spki)
  assert.match(id, /^[a-p]{32}$/)
  assert.equal(id, extensionId(Buffer.from(spki)))
})
