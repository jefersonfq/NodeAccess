#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..', '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeaccess-doctor-harness-'))
const binDir = path.join(tmpRoot, 'bin')
const backupDir = path.join(tmpRoot, 'backups')
const volumeDir = path.join(tmpRoot, 'volumes')
const envFile = path.join(tmpRoot, '.env')
const composeFile = path.join(tmpRoot, 'docker-compose.prod.yml')

fs.mkdirSync(binDir, { recursive: true })
fs.mkdirSync(backupDir, { recursive: true })
fs.mkdirSync(path.join(volumeDir, 'mysql_data'), { recursive: true })
fs.mkdirSync(path.join(volumeDir, 'redis_data'), { recursive: true })
fs.mkdirSync(path.join(volumeDir, 'session_audit_data'), { recursive: true })

fs.writeFileSync(envFile, [
  'NODE_ENV=development',
  'APP_URL=http://127.0.0.1',
  'TLS_MODE=off',
  'DATABASE_URL=mysql://nodeaccess:nodeaccess@mysql:3306/nodeaccess',
  'REDIS_URL=redis://redis:6379',
  'JWT_SECRET=12345678901234567890123456789012',
  'PEM_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'DB_ROOT_PASSWORD=root-password',
  'DB_NAME=nodeaccess',
  'DB_USER=nodeaccess',
  'DB_PASSWORD=nodeaccess',
  'PASSWORD_POLICY_REGEX=^(?=.*[A-Z])(?=.*\\d).{8,}$',
  '',
].join('\n'))

fs.writeFileSync(composeFile, [
  'services:',
  '  mysql:',
  '    image: mysql:8.0',
  '  redis:',
  '    image: redis:7-alpine',
  '  api:',
  '    image: nodeaccess-backend:0.1.0',
  'volumes:',
  '  mysql_data:',
  '  redis_data:',
  '  session_audit_data:',
  '',
].join('\n'))

const backupFile = path.join(backupDir, 'nodeaccess-mysql-nodeaccess-20260723-120000.manifest.json')
fs.writeFileSync(backupFile, '{"type":"nodeaccess-mysql-backup"}\n')

const fakeDocker = `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "compose" ]]; then
  shift
  args="$*"
  if [[ "$args" == *"config --services"* ]]; then
    printf 'mysql\\nredis\\napi\\n'
    exit 0
  fi
  if [[ "$args" == *"config --images"* ]]; then
    printf 'mysql:8.0\\nredis:7-alpine\\nnodeaccess-backend:0.1.0\\n'
    exit 0
  fi
  if [[ "$args" == *"config --volumes"* ]]; then
    printf 'mysql_data\\nredis_data\\nsession_audit_data\\n'
    exit 0
  fi
  if [[ "$args" == *"config"* ]]; then
    printf 'services:\\n  mysql:\\n  redis:\\n  api:\\n'
    exit 0
  fi
  if [[ "$args" == *"ps"* ]]; then
    printf 'NAME STATUS\\nnodeaccess-api running\\n'
    exit 0
  fi
fi

if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  exit 0
fi

if [[ "$1" == "volume" && "$2" == "inspect" ]]; then
  case "$3" in
    nodeaccess_mysql_data) printf '${path.join(volumeDir, 'mysql_data').replace(/'/g, "'\\''")}\\n' ;;
    nodeaccess_redis_data) printf '${path.join(volumeDir, 'redis_data').replace(/'/g, "'\\''")}\\n' ;;
    nodeaccess_session_audit_data) printf '${path.join(volumeDir, 'session_audit_data').replace(/'/g, "'\\''")}\\n' ;;
    *) exit 1 ;;
  esac
  exit 0
fi

echo "unexpected docker call: $*" >&2
exit 1
`

const dockerPath = path.join(binDir, 'docker')
fs.writeFileSync(dockerPath, fakeDocker)
fs.chmodSync(dockerPath, 0o755)

function runDoctor(extraEnv = {}) {
  return spawnSync('bash', ['scripts/deploy/doctor-nodeaccess.sh'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ENV_FILE: envFile,
      COMPOSE_FILE: composeFile,
      BACKUP_DIR: backupDir,
      TLS_MODE: 'off',
      MIN_DISK_FREE_MB: '1',
      MAX_BACKUP_AGE_HOURS: '100000',
      RUN_SMOKE_CHECK: 'false',
      RUN_DEEP_HEALTH_CHECK: 'false',
      ...extraEnv,
    },
    encoding: 'utf8',
  })
}

const jsonRun = runDoctor({ DOCTOR_OUTPUT: 'json' })
if (jsonRun.status !== 0) {
  console.error(jsonRun.stdout)
  console.error(jsonRun.stderr)
  throw new Error(`doctor json run failed with status ${jsonRun.status}`)
}

let report
try {
  report = JSON.parse(jsonRun.stdout)
} catch (error) {
  console.error(jsonRun.stdout)
  throw new Error(`doctor json output is not valid JSON: ${error.message}`)
}

const findings = []
if (report.status !== 'degraded') findings.push(`expected degraded status because smoke check is disabled, got ${report.status}`)
if (!Array.isArray(report.checks) || report.checks.length < 8) findings.push('expected at least 8 checks in JSON report')
if (report.config?.tlsMode !== 'off') findings.push(`expected tlsMode=off, got ${report.config?.tlsMode}`)
if (report.config?.backupDir !== backupDir) findings.push('backupDir was not reflected in JSON config')
if (!report.checks?.some((check) => check.level === 'ok' && check.message.includes('Backup recente encontrado'))) {
  findings.push('recent backup check was not reported as ok')
}
if (!report.checks?.some((check) => check.level === 'ok' && check.message.includes('Compose valido'))) {
  findings.push('compose services check was not reported as ok')
}
if (!report.checks?.some((check) => check.level === 'warn' && check.message.includes('Smoke check nao executado'))) {
  findings.push('disabled smoke check warning was not reported')
}

const textRun = runDoctor({ DOCTOR_OUTPUT: 'text' })
if (textRun.status !== 0) {
  console.error(textRun.stdout)
  console.error(textRun.stderr)
  throw new Error(`doctor text run failed with status ${textRun.status}`)
}
if (!textRun.stdout.includes('[ok] Ambiente valido')) findings.push('text mode did not print ok checks')
if (!textRun.stdout.includes('Doctor concluido com')) findings.push('text mode did not print final summary')

const invalidRun = runDoctor({ DOCTOR_OUTPUT: 'xml' })
if (invalidRun.status === 0) findings.push('invalid DOCTOR_OUTPUT should fail')

const result = {
  tmpRoot,
  jsonStatus: report.status,
  warningCount: report.warnings,
  checkCount: report.checks?.length || 0,
  findings,
}

console.log(JSON.stringify(result, null, 2))
if (findings.length) process.exit(1)
