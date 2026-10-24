#!/usr/bin/env node
import { readFileSync, realpathSync, statSync, mkdirSync, rmdirSync, writeFileSync, renameSync, unlinkSync, chownSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseEnv } from 'node:util'

const flag = 'TRIAL_REGISTRATION_ENABLED'

export function validateTrialConfiguration(values) {
  const required = ['TRIAL_PUBLIC_URL', 'TRIAL_PROVISIONER_URL', 'TRIAL_PROVISIONER_TOKEN', 'TRIAL_SMTP_HOST', 'TRIAL_SMTP_USER', 'TRIAL_SMTP_PASSWORD', 'TRIAL_SMTP_FROM']
  for (const name of required) {
    if (!values[name]?.trim()) throw new Error(`Configure ${name} antes de habilitar o cadastro.`)
  }
  for (const name of ['TRIAL_PUBLIC_URL', 'TRIAL_PROVISIONER_URL']) {
    let url
    try { url = new URL(values[name]) } catch { throw new Error(`${name} deve ser uma URL HTTPS válida.`) }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error(`${name} deve usar HTTPS, sem credenciais, query ou fragmento.`)
    }
  }
  const port = values.TRIAL_SMTP_PORT || '587'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('TRIAL_SMTP_PORT deve estar entre 1 e 65535.')
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(values.TRIAL_SMTP_FROM)) throw new Error('TRIAL_SMTP_FROM deve ser um endereço de e-mail.')
  if (values.TRIAL_PROVISIONER_TOKEN.length < 32) throw new Error('TRIAL_PROVISIONER_TOKEN deve ter pelo menos 32 caracteres.')
}

export function configureTrial(envPath, action) {
  if (!['enable', 'disable', 'check'].includes(action)) throw new Error('Ação inválida.')
  // Resolve shared/.env symlinks without replacing the symlink used by releases.
  const target = realpathSync(envPath)
  const stat = statSync(target)
  if (!stat.isFile()) throw new Error('O arquivo de ambiente deve ser regular.')
  const lock = `${target}.trial.lock`
  mkdirSync(lock, { mode: 0o700 })
  let temporary
  try {
    const original = readFileSync(target, 'utf8')
    const assignment = /^(?:[ \t]*export[ \t]+)?[ \t]*TRIAL_REGISTRATION_ENABLED[ \t]*=/gm
    if ([...original.matchAll(assignment)].length > 1) throw new Error('TRIAL_REGISTRATION_ENABLED duplicada; resolva a ambiguidade antes de continuar.')
    const values = parseEnv(original)
    if (action === 'check') {
      if (![undefined, 'true', 'false'].includes(values[flag])) throw new Error('TRIAL_REGISTRATION_ENABLED deve ser true ou false.')
      if (values[flag] === 'true') validateTrialConfiguration(values)
      return { changed: false, enabled: values[flag] === 'true' }
    }
    if (action === 'enable') validateTrialConfiguration(values)
    const enabled = action === 'enable'
    if (values[flag] === String(enabled)) return { changed: false, enabled }
    const newline = original.includes('\r\n') ? '\r\n' : '\n'
    const updated = assignment.test(original)
      ? original.replace(/^(?:[ \t]*export[ \t]+)?[ \t]*TRIAL_REGISTRATION_ENABLED[ \t]*=.*$/m, `${flag}=${enabled}`)
      : `${original}${original && !original.endsWith('\n') ? newline : ''}${flag}=${enabled}${newline}`
    const backup = `${target}.trial-${randomUUID()}.bak`
    writeFileSync(backup, original, { flag: 'wx', mode: 0o600 })
    temporary = resolve(dirname(target), `.trial-${randomUUID()}.tmp`)
    writeFileSync(temporary, updated, { flag: 'wx', mode: stat.mode & 0o600 })
    chownSync(temporary, stat.uid, stat.gid)
    if (readFileSync(target, 'utf8') !== original) throw new Error('Arquivo alterado durante a operação; nenhuma configuração foi substituída.')
    renameSync(temporary, target)
    temporary = undefined
    return { changed: true, enabled }
  } finally {
    if (temporary) unlinkSync(temporary)
    rmdirSync(lock)
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('Uso: node scripts/deploy/configure-trial.mjs --env-file /caminho/.env --enable|--disable|--check')
    return
  }
  if (args.length !== 3 || args[0] !== '--env-file' || !['--enable', '--disable', '--check'].includes(args[2])) throw new Error('Informe --env-file PATH e exatamente uma ação: --enable, --disable ou --check.')
  const result = configureTrial(resolve(args[1]), args[2].slice(2))
  console.log(`Cadastro público de degustação: ${result.enabled ? 'habilitado na configuração' : 'desabilitado na configuração'}.`)
  if (result.changed) console.log('Configuração atualizada com cópia privada de recuperação. Recrie a API na janela de manutenção para aplicar.')
  console.log('Contas existentes não foram alteradas. A validação de perfil, isolamento e prontidão continua obrigatória no backend.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) {
    // Do not echo paths, file content, URLs or secrets from filesystem/parser errors.
    console.error(error?.code ? 'Não foi possível acessar ou atualizar a configuração; verifique permissões e se há outra operação em andamento.' : error.message)
    process.exitCode = 1
  }
}
