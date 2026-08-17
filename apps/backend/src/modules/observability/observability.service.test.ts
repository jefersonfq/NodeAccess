import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const JWT_SECRET = 'test-secret-with-at-least-thirty-two-chars'

describe('observability service', () => {
  it('parses docker stats json lines into normalized metrics', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:password@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
    const { parseDockerStatsOutput } = await import('./observability.service.js')

    const rows = parseDockerStatsOutput([
      '{"ID":"abc","Name":"nodeaccess-api","CPUPerc":"3.50%","MemUsage":"128MiB / 1GiB","MemPerc":"12.50%","NetIO":"1.2MB / 3.4MB","BlockIO":"5kB / 6kB"}',
      '',
    ].join('\n'))

    expect(rows).toEqual([expect.objectContaining({
      id: 'abc',
      name: 'nodeaccess-api',
      cpuPercent: 3.5,
      memoryUsageBytes: 134217728,
      memoryLimitBytes: 1073741824,
      memoryPercent: 12.5,
      networkInputBytes: 1200000,
      networkOutputBytes: 3400000,
      blockInputBytes: 5000,
      blockOutputBytes: 6000,
    })])
  })

  it('returns degraded snapshot when docker stats is unavailable without failing the request', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:password@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
    vi.stubEnv('SESSION_AUDIT_STORAGE_DIR', '/tmp/nodeaccess-observability-test')
    const { buildObservabilitySnapshot } = await import('./observability.service.js')
    const commandRunner = vi.fn(async (file: string) => {
      if (file === 'docker') throw new Error('docker daemon unavailable')
      return {
        stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 250 750 25% /\n',
        stderr: '',
      }
    })

    const snapshot = await buildObservabilitySnapshot({
      commandRunner,
      diskPaths: ['/tmp'],
      backupDir: '/tmp/nodeaccess-observability-missing-backups',
      cacheTtlMs: 0,
      includeComponents: false,
    })

    expect(snapshot.status).toBe('degraded')
    expect(snapshot.warnings).toContain('Docker stats indisponivel')
    expect(snapshot.warnings).toContain('Um ou mais backups nao foram encontrados')
    expect(snapshot.host.disks).toEqual([expect.objectContaining({
      path: '/tmp',
      totalBytes: 1024000,
      usedBytes: 256000,
      availableBytes: 768000,
      usedPercent: 25,
    })])
    expect(snapshot.docker).toMatchObject({
      status: 'unavailable',
      containers: [],
      message: 'Docker stats indisponivel neste no. Verifique se a API tem acesso ao Docker CLI/socket.',
    })
    expect(snapshot.scope).toMatchObject({
      kind: 'node',
      aggregation: 'local-only',
    })
  })

  it('translates missing backup directory errors to operator friendly messages', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:password@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
    vi.stubEnv('SESSION_AUDIT_STORAGE_DIR', '/tmp/nodeaccess-observability-test')
    const { buildObservabilitySnapshot } = await import('./observability.service.js')
    const commandRunner = vi.fn(async (file: string) => {
      if (file === 'docker') return { stdout: '', stderr: '' }
      return {
        stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 250 750 25% /\n',
        stderr: '',
      }
    })

    const snapshot = await buildObservabilitySnapshot({
      commandRunner,
      diskPaths: ['/tmp'],
      backupDir: '/tmp/nodeaccess-observability-definitely-missing',
      cacheTtlMs: 0,
      includeComponents: false,
    })

    expect(snapshot.backups).toEqual([
      expect.objectContaining({ type: 'mysql', message: 'Diretorio de backups nao encontrado' }),
      expect.objectContaining({ type: 'session_audit', message: 'Diretorio de backups nao encontrado' }),
    ])
  })

  it('reports latest mysql and session audit backups', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:password@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
    vi.stubEnv('SESSION_AUDIT_STORAGE_DIR', '/tmp/nodeaccess-observability-test')
    const backupDir = await mkdtemp(path.join(os.tmpdir(), 'nodeaccess-observability-backups-'))
    const { buildObservabilitySnapshot } = await import('./observability.service.js')
    const commandRunner = vi.fn(async (file: string) => {
      if (file === 'docker') {
        return {
          stdout: '{"Name":"nodeaccess-redis","CPUPerc":"1%","MemUsage":"10MiB / 100MiB","MemPerc":"10%","NetIO":"0B / 0B","BlockIO":"0B / 0B"}\n',
          stderr: '',
        }
      }
      return {
        stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 250 750 25% /\n',
        stderr: '',
      }
    })

    try {
      await writeFile(path.join(backupDir, 'nodeaccess-mysql-nodeaccess-20260723-120000.manifest.json'), '{}')
      await writeFile(path.join(backupDir, 'nodeaccess-session-audit-20260723-120000.manifest.json'), '{}')

      const snapshot = await buildObservabilitySnapshot({
        commandRunner,
        diskPaths: ['/tmp'],
        backupDir,
        cacheTtlMs: 0,
        includeComponents: false,
        now: () => new Date('2026-07-23T15:00:00.000Z'),
      })

      expect(snapshot.backups).toEqual([
        expect.objectContaining({ type: 'mysql', status: 'ok', ageHours: expect.any(Number) }),
        expect.objectContaining({ type: 'session_audit', status: 'ok', ageHours: expect.any(Number) }),
      ])
      expect(snapshot.docker.containers).toEqual([expect.objectContaining({ name: 'nodeaccess-redis' })])
    } finally {
      await rm(backupDir, { recursive: true, force: true })
    }
  })

  it('keeps a bounded in-memory history of collected snapshots', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:password@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
    vi.stubEnv('SESSION_AUDIT_STORAGE_DIR', '/tmp/nodeaccess-observability-test')
    vi.stubEnv('OBSERVABILITY_HISTORY_LIMIT', '2')
    vi.stubEnv('OBSERVABILITY_CPU_WARNING_PERCENT', '1000')
    vi.stubEnv('OBSERVABILITY_MEMORY_WARNING_PERCENT', '101')
    vi.stubEnv('OBSERVABILITY_DISK_WARNING_PERCENT', '101')
    const backupDir = await mkdtemp(path.join(os.tmpdir(), 'nodeaccess-observability-history-'))
    const { buildObservabilitySnapshot, clearObservabilityCache } = await import('./observability.service.js')
    const commandRunner = vi.fn(async (file: string) => {
      if (file === 'docker') {
        return {
          stdout: '{"Name":"nodeaccess-api","CPUPerc":"1%","MemUsage":"10MiB / 100MiB","MemPerc":"10%","NetIO":"0B / 0B","BlockIO":"0B / 0B"}\n',
          stderr: '',
        }
      }
      return {
        stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 250 750 25% /\n',
        stderr: '',
      }
    })

    try {
      clearObservabilityCache()
      await writeFile(path.join(backupDir, 'nodeaccess-mysql-nodeaccess-20260723-120000.manifest.json'), '{}')
      await writeFile(path.join(backupDir, 'nodeaccess-session-audit-20260723-120000.manifest.json'), '{}')

      await buildObservabilitySnapshot({
        commandRunner,
        recordHistory: true,
        diskPaths: ['/tmp'],
        backupDir,
        cacheTtlMs: 0,
        includeComponents: false,
        now: () => new Date('2026-07-23T15:00:00.000Z'),
      })
      await buildObservabilitySnapshot({
        commandRunner,
        recordHistory: true,
        diskPaths: ['/tmp'],
        backupDir,
        cacheTtlMs: 0,
        includeComponents: false,
        now: () => new Date('2026-07-23T15:00:05.000Z'),
      })
      const snapshot = await buildObservabilitySnapshot({
        commandRunner,
        recordHistory: true,
        diskPaths: ['/tmp'],
        backupDir,
        cacheTtlMs: 0,
        includeComponents: false,
        now: () => new Date('2026-07-23T15:00:10.000Z'),
      })

      expect(snapshot.history).toHaveLength(2)
      expect(snapshot.history.map((point) => point.timestamp)).toEqual([
        '2026-07-23T15:00:05.000Z',
        '2026-07-23T15:00:10.000Z',
      ])
      expect(snapshot.history.at(-1)).toEqual(expect.objectContaining({
        status: 'ok',
        diskPercent: 25,
        unavailableComponents: 0,
        unavailableBackups: 0,
        dockerStatus: 'ok',
      }))
    } finally {
      clearObservabilityCache()
      await rm(backupDir, { recursive: true, force: true })
    }
  })

  it('marks the snapshot as degraded when resource thresholds are exceeded', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:password@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
    vi.stubEnv('SESSION_AUDIT_STORAGE_DIR', '/tmp/nodeaccess-observability-test')
    vi.stubEnv('OBSERVABILITY_CPU_WARNING_PERCENT', '101')
    vi.stubEnv('OBSERVABILITY_MEMORY_WARNING_PERCENT', '101')
    vi.stubEnv('OBSERVABILITY_DISK_WARNING_PERCENT', '20')
    vi.stubEnv('OBSERVABILITY_BACKUP_MAX_AGE_HOURS', '999999')
    const backupDir = await mkdtemp(path.join(os.tmpdir(), 'nodeaccess-observability-thresholds-'))
    const { buildObservabilitySnapshot } = await import('./observability.service.js')
    const commandRunner = vi.fn(async (file: string) => {
      if (file === 'docker') {
        return {
          stdout: '{"Name":"nodeaccess-api","CPUPerc":"1%","MemUsage":"10MiB / 100MiB","MemPerc":"10%","NetIO":"0B / 0B","BlockIO":"0B / 0B"}\n',
          stderr: '',
        }
      }
      return {
        stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 250 750 25% /\n',
        stderr: '',
      }
    })

    try {
      await writeFile(path.join(backupDir, 'nodeaccess-mysql-nodeaccess-20260723-120000.manifest.json'), '{}')
      await writeFile(path.join(backupDir, 'nodeaccess-session-audit-20260723-120000.manifest.json'), '{}')

      const snapshot = await buildObservabilitySnapshot({
        commandRunner,
        diskPaths: ['/tmp'],
        backupDir,
        cacheTtlMs: 0,
        includeComponents: false,
      })

      expect(snapshot.status).toBe('degraded')
      expect(snapshot.thresholds.diskWarningPercent).toBe(20)
      expect(snapshot.warnings).toContain('Disco acima do limite (25%)')
    } finally {
      await rm(backupDir, { recursive: true, force: true })
    }
  })
})
