export interface PasswordOptions {
  length?: number
  uppercase?: boolean
  lowercase?: boolean
  digits?: boolean
  symbols?: boolean
}
const classes = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{}:,.?',
}
/** Byte rejection avoids modulo bias. Whole-candidate rejection keeps class guarantees unbiased. */
export function generatePassword(options?: PasswordOptions): string {
  // Preserve the established no-options API used by the personal-secret editor.
  if (!options) {
    const alphabet = classes.uppercase + classes.lowercase + classes.digits + '-_'
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => alphabet[byte & 63]).join('')
  }
  const length = options.length ?? 24
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new Error('Invalid password length')
  const selected = Object.entries(classes).filter(([key]) => options[key as keyof typeof classes] ?? true).map(([, value]) => value)
  if (!selected.length) throw new Error('Select a character class')
  const alphabet = selected.join(''), limit = Math.floor(256 / alphabet.length) * alphabet.length
  for (let attempt = 0; attempt < 1024; attempt++) {
    let candidate = ''
    // Bound failures even if a faulty entropy provider never produces an accepted byte.
    for (let batch = 0; batch < 16 && candidate.length < length; batch++) {
      const bytes = crypto.getRandomValues(new Uint8Array(128))
      for (const byte of bytes) {
        if (byte < limit) candidate += alphabet[byte % alphabet.length]
        if (candidate.length === length) break
      }
    }
    if (candidate.length !== length) throw new Error('Password generation unavailable')
    if (selected.every(group => [...candidate].some(character => group.includes(character)))) return candidate
  }
  throw new Error('Password generation unavailable')
}
