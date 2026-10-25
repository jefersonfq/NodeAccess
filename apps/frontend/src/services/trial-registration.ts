const brazilAreaCodes = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '))
export function trialNameError(value: string): string {
  const name = value.trim().normalize('NFC').replace(/\s+/gu, ' ')
  return name.length <= 100 && /^[\p{L}\p{M}]+(?:[’' -][\p{L}\p{M}]+)*$/u.test(name) && name.split(/\s+/).filter(word => (word.match(/\p{L}/gu) ?? []).length >= 3).length >= 2 ? '' : 'Informe seu nome completo, com pelo menos duas palavras de três letras. Partículas como “da” são permitidas.'
}
export function trialEmailError(value: string): string {
  const email = value.trim()
  return email.length <= 254 && /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+\-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/.test(email) ? '' : 'Informe um e-mail válido, com domínio completo, como nome@exemplo.com.'
}
export function trialPhoneError(value: string): string {
  const phone = value.trim()
  if (!phone) return ''
  const compact = phone.replace(/[ ()-]/g, '')
  if (phone.length > 40 || !/^\+?[0-9 ()-]+$/.test(phone) || !/^\+?\d{8,15}$/.test(compact) || compact.startsWith('+0')) return 'Informe um telefone válido com DDD; para outro país, use +DDI e número.'
  if (compact.startsWith('+') && !compact.startsWith('+55')) return ''
  const national = compact.replace(/^\+55/, '')
  return brazilAreaCodes.has(national.slice(0, 2)) && (/^\d{2}[2-5]\d{7}$/.test(national) || /^\d{2}9\d{8}$/.test(national)) ? '' : 'Informe um DDD válido e um telefone brasileiro: fixo com 10 dígitos ou celular com 11.'
}
/** Invalid characters remain visible for validation; international input is never reformatted. */
export function formatTrialPhone(value: string): string {
  if (value.trimStart().startsWith('+') || !/^[0-9 ()-]*$/.test(value)) return value
  const digits = value.replace(/\D/g, '')
  if (digits.length > 11 || !digits) return value
  if (digits.length < 3) return `(${digits}`
  const subscriber = digits.slice(2)
  const split = digits.length > 10 ? 5 : 4
  return `(${digits.slice(0, 2)}) ${subscriber.slice(0, split)}${subscriber.length > split ? `-${subscriber.slice(split)}` : ''}`
}
