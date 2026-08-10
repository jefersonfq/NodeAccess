export function isEncryptedPrivateKey(content: string): boolean {
  const normalized = content.trim()
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(normalized)) return true
  if (/Proc-Type:\s*4,ENCRYPTED/i.test(normalized)) return true
  const puttyEncryption = normalized.match(/^Encryption:\s*(.+)$/mi)?.[1]?.trim()
  if (puttyEncryption) return puttyEncryption.toLowerCase() !== 'none'
  if (!normalized.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) return false

  try {
    const encoded = normalized
      .replace(/-----BEGIN OPENSSH PRIVATE KEY-----|-----END OPENSSH PRIVATE KEY-----|\s/g, '')
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    const magicLength = 'openssh-key-v1\0'.length
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const cipherLength = view.getUint32(magicLength)
    const cipher = new TextDecoder().decode(bytes.slice(magicLength + 4, magicLength + 4 + cipherLength))
    return cipher !== 'none'
  } catch {
    return false
  }
}
