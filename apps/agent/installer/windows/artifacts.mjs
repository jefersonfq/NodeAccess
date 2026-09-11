import { verifyFile } from '../release-signing.mjs'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export const artifactNames = ['nodeaccess-agent-win.exe', 'nodeaccess-agent-windows-x64.msi']
export const manifestName = 'nodeaccess-agent-windows-x64.json'
export const distributionNames = [...artifactNames, ...artifactNames.map(name => `${name}.sha256`), manifestName, `${manifestName}.sig`]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

// Include new runtime files automatically. Normalize checkout line endings so
// Windows-generated packages can be validated in the Linux release builder.
export function sourceDigest(root = projectRoot) {
  const files = ['package-lock.json', 'apps/agent/package.json']
  function walk(relative) {
    for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`
      if (entry.name === 'release-trust.json') continue // build-injected trust is verified against the independent release key
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(path)
      else throw new Error(`Entrada de build nao suportada: ${path}`)
    }
  }
  walk('apps/agent/src')
  walk('apps/agent/installer')
  return hash(JSON.stringify(files.sort().map(path => {
    const bytes = readFileSync(resolve(root, path))
    const content = ['.js', '.mjs', '.cjs', '.json', '.ps1', '.wxs', '.svg', '.cs'].includes(extname(path))
      ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes
    return [path, hash(content)]
  })))
}

export function validateArtifacts(directory, root = projectRoot) {
  const manifest = JSON.parse(readFileSync(resolve(directory, manifestName), 'utf8').replace(/^\uFEFF/, ''))
  const version = JSON.parse(readFileSync(resolve(root, 'apps/agent/package.json'), 'utf8')).version
  if (manifest.product !== 'NodeAccess Agent' || manifest.platform !== 'windows' || manifest.architecture !== 'x64') {
    throw new Error('Identidade invalida no manifesto Windows')
  }
  if (manifest.version !== version) throw new Error(`Versao Windows divergente: esperado ${version}`)
  if (manifest.sourceSha256 !== sourceDigest(root)) throw new Error('Artefatos Windows desatualizados: gere novamente o MSI a partir deste codigo e package-lock.json')
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== artifactNames.length) throw new Error('Lista de artefatos Windows invalida')
  for (const name of artifactNames) {
    const entries = manifest.artifacts.filter(item => item.file === name)
    if (entries.length !== 1) throw new Error(`Artefato ausente ou duplicado no manifesto: ${name}`)
    const bytes = readFileSync(resolve(directory, name))
    const digest = hash(bytes)
    if (bytes.length === 0 || entries[0].size !== bytes.length || entries[0].sha256 !== digest) throw new Error(`Integridade invalida: ${name}`)
    const checksum = readFileSync(resolve(directory, `${name}.sha256`), 'utf8').trim()
    if (checksum !== `${digest}  ${name}`) throw new Error(`Checksum invalido: ${name}`)
  }
  verifyFile(resolve(directory, manifestName))
  return manifest
}

export function importArtifacts(source, destination, root = projectRoot) {
  validateArtifacts(source, root)
  if (resolve(source) !== resolve(destination)) {
    mkdirSync(destination, { recursive: true })
    for (const name of distributionNames.filter(name => process.env.NODEACCESS_DEVELOPMENT_UNSIGNED !== 'true' || !name.endsWith('.sig'))) copyFileSync(resolve(source, name), resolve(destination, name))
  }
  return validateArtifacts(destination, root)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'source-digest') console.log(sourceDigest())
    else if (process.argv[2] === 'validate') {
      const result = validateArtifacts(resolve(process.argv[3] || resolve(projectRoot, 'apps/agent/dist')))
      console.log(`Artefatos Windows ${result.version}: integridade e fontes validadas`)
    } else throw new Error('Uso: node artifacts.mjs source-digest | validate [diretorio]')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
