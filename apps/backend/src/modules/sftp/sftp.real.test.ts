import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LogRepository } from '../logs/log.repository.js'
import { encrypt } from '../../shared/crypto.js'
import { SftpService } from './sftp.service.js'
import { SftpController } from './sftp.controller.js'
import { sftpRoutes } from './sftp.routes.js'

// Explicit opt-in: use only an isolated SSH server with disposable data.
describe.skipIf(process.env.RUN_SFTP_REAL !== 'true')('SFTP real: Fastify -> ssh2 -> OpenSSH', () => {
  let app: FastifyInstance
  let service: SftpService
  let root: string
  const audit = vi.fn<LogRepository['logAdminEvent']>().mockResolvedValue(undefined)
  const ctx = [10, 20, 1, 'user'] as const

  beforeAll(async () => {
    const host = {
      id: 10, tenantId: 1, deviceProfile: 'server_ssh',
      ip: process.env.SFTP_TEST_HOST ?? '127.0.0.1', port: Number(process.env.SFTP_TEST_PORT ?? 22283),
      sshUser: process.env.SFTP_TEST_USER ?? 'sftptest', authType: 'PASSWORD',
      passwordEncrypted: JSON.stringify(encrypt(process.env.SFTP_TEST_PASSWORD ?? 'disposable-sftp-review')),
      pemKey: null, onePasswordRef: null, bastion: null,
    }
    service = new SftpService({
      findHostWithCredentials: vi.fn().mockResolvedValue(host),
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(true),
    } as never, {} as never)
    const { home } = await service.ping(...ctx)
    root = `${home}/review-${randomUUID()}`
    await service.mkdir(...ctx, root)
    app = Fastify()
    app.decorateRequest('jwtVerify', () => Promise.resolve({ sub: '20', tenantId: 1, role: 'user', stage: 'authenticated' }))
    await app.register(multipart)
    await sftpRoutes(app, new SftpController(service, { logAdminEvent: audit } as never))
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    if (!root) return
    async function clean(path: string): Promise<void> {
      for (const item of (await service.list(...ctx, path)).entries) {
        if (item.type === 'directory') await clean(item.path)
        await service.delete(...ctx, item.path)
      }
    }
    await clean(root)
    await service.delete(...ctx, root)
  }, 30_000)

  it('creates, lists, uploads, reads, downloads, renames and deletes Unicode paths', async () => {
    const folder = `${root}/pasta com espaço ç`
    expect((await app.inject({ method: 'POST', url: '/10/mkdir', payload: { path: folder } })).statusCode).toBe(204)
    const path = `${folder}/ação.txt`
    await service.createFile(...ctx, path)
    await service.upload(...ctx, path, Buffer.from('Olá SFTP\n'))
    expect((await service.readFile(...ctx, path)).content).toBe('Olá SFTP\n')
    expect((await service.download(...ctx, path)).toString()).toBe('Olá SFTP\n')
    expect((await service.list(...ctx, folder)).entries.map(e => e.name)).toContain('ação.txt')
    await service.rename(...ctx, path, `${folder}/renomeado.txt`)
    await service.delete(...ctx, `${folder}/renomeado.txt`)
    await service.delete(...ctx, folder)
  }, 30_000)

  it('edits with optimistic version checks, records audit, downloads/diffs/restores backup', async () => {
    const path = `${root}/editor.conf`
    await service.upload(...ctx, path, Buffer.from('mode=old\n'))
    const before = await service.readFile(...ctx, path)
    const result = await app.inject({ method: 'PUT', url: '/10/write', payload: {
      path, content: 'mode=new\n', expectedHash: before.hash, expectedSize: before.size, sessionId: 77,
    } })
    expect(result.statusCode, result.body).toBe(204)
    expect((await service.download(...ctx, path)).toString()).toBe('mode=new\n')
    const event = audit.mock.calls.map(([e]) => JSON.parse(e.details ?? '') as { action: string; path: string; backupPath: string }).find(e => e.action === 'writeFile' && e.path === path)
    if (!event) throw new Error('Expected writeFile audit event')
    expect(event).toMatchObject({ success: true, sessionId: 77, preservedMode: true })
    expect((await app.inject({ method: 'GET', url: `/10/download-backup?${new URLSearchParams({ path, backupPath: event.backupPath }).toString()}` })).body).toBe('mode=old\n')
    const diff = await app.inject({ method: 'GET', url: `/10/backup-diff?${new URLSearchParams({ path, backupPath: event.backupPath }).toString()}` })
    expect(diff.statusCode).toBe(200)
    expect(diff.json<{ diffMasked: string }>().diffMasked).toContain('mode=new')
    expect((await app.inject({ method: 'PUT', url: '/10/write', payload: { path, content: 'stale\n', expectedHash: before.hash } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/10/restore-backup', payload: { path, backupPath: event.backupPath } })).statusCode).toBe(204)
    expect((await service.download(...ctx, path)).toString()).toBe('mode=old\n')
  }, 60_000)

  it('maps missing paths and invalid backup locations safely', async () => {
    const result = await app.inject({ method: 'GET', url: `/10/read?path=${encodeURIComponent(`${root}/missing`)}` })
    expect(result.statusCode).toBe(404)
    const restore = await app.inject({ method: 'POST', url: '/10/restore-backup', payload: { path: `${root}/x`, backupPath: '/etc/passwd' } })
    expect(restore.statusCode).toBe(400)
  })

  it('SFTP-08: preserves private file permissions in backup and restoration', async () => {
    const path = `${root}/private.conf`
    await service.upload(...ctx, path, Buffer.from('mode=private\n'))
    await service.applyFileMetadata(...ctx, path, { mode: 0o600 })
    const before = await service.readFile(...ctx, path)
    expect(before.mode).toBe(0o600)
    const written = await app.inject({ method: 'PUT', url: '/10/write', payload: { path, content: 'mode=edited\n', expectedHash: before.hash } })
    expect(written.statusCode, written.body).toBe(204)
    const event = audit.mock.calls.map(([e]) => JSON.parse(e.details ?? '') as { action: string; path: string; backupPath: string }).find(e => e.action === 'writeFile' && e.path === path)
    if (!event) throw new Error('Expected writeFile audit event')
    const backup = await service.readFile(...ctx, event.backupPath)
    const edited = await service.readFile(...ctx, path)
    expect(edited.mode).toBe(0o600)
    const restored = await app.inject({ method: 'POST', url: '/10/restore-backup', payload: { path, backupPath: event.backupPath } })
    expect(restored.statusCode, restored.body).toBe(204)
    const after = await service.readFile(...ctx, path)
    console.info(JSON.stringify({ scenario: 'real-private-file-metadata', beforeMode: before.mode?.toString(8), backupMode: backup.mode?.toString(8), editedMode: edited.mode?.toString(8), restoredMode: after.mode?.toString(8) }))
    expect(backup.mode).toBe(0o600)
    expect(after.mode).toBe(0o600)
  }, 30_000)

  it('measures actual editor truncation on a 2 MiB file', async () => {
    const path = `${root}/large.txt`
    await service.upload(...ctx, path, Buffer.alloc(2_097_152, 'a'))
    const read = await service.readFile(...ctx, path)
    expect(read.content.length).toBe(1_048_576)
    expect(read.size).toBe(2_097_152)
    // Diagnostic evidence: record both outcomes; deterministic boundary regression is in sftp.review.test.ts.
    console.info(JSON.stringify({ scenario: 'real-large-file', size: read.size, returnedBytes: read.content.length, truncated: read.truncated, hashPresent: read.hash !== null }))
  })

  it.skipIf(process.env.RUN_SFTP_BROWSER !== 'true')('runs browser upload/download/rename/delete through real HTTP and SFTP', async () => {
    const { chromium } = await import('playwright')
    const uiDir = `${root}/browser`
    await service.mkdir(...ctx, uiDir)
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium-browser', headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const payload = { sub: '20', tenantId: 1, role: 'admin', stage: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }
    const token = `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.review`
    await context.addInitScript(token => { localStorage.setItem('na_access_token', token); localStorage.setItem('na_refresh_token', 'review'); localStorage.setItem('nodeaccess_locale', 'pt-BR') }, token)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/v1/sftp/')) {
        const target = new URL(url.pathname.replace('/api/v1/sftp', '') + url.search, address)
        if (target.pathname.endsWith('/list') && target.searchParams.get('path') === '/') target.searchParams.set('path', root)
        const response = await route.fetch({ url: target.toString() })
        await route.fulfill({ response })
        return
      }
      let data: unknown = []
      if (url.pathname.endsWith('/features')) data = { integrationProviders: {} }
      else if (url.pathname.endsWith('/users/me/preferences')) data = null
      else if (url.pathname.endsWith('/sessions/access-map')) data = { hosts: [], totals: {}, refreshAfterSeconds: 30 }
      else if (url.pathname.endsWith('/auth/refresh')) data = { accessToken: token }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })
    const out = process.env.SFTP_BROWSER_REPORT_DIR ?? '/tmp/nodeaccess-sftp-review-live-browser'
    mkdirSync(out, { recursive: true })
    try {
      await page.goto(`${process.env.FRONTEND_BASE ?? 'http://127.0.0.1:5179'}/files/10`)
      await page.getByText('SFTP conectado', { exact: true }).waitFor()
      await page.locator('tbody tr').filter({ hasText: /^.*browser/ }).dblclick()
      await page.getByText('Pasta vazia', { exact: true }).waitFor()
      await page.locator('input[type=file]').setInputFiles({ name: 'uploaded.txt', mimeType: 'text/plain', buffer: Buffer.from('real-browser-SFTP\n') })
      const row = page.locator('tbody tr').filter({ hasText: 'uploaded.txt' })
      await row.waitFor()
      expect((await service.download(...ctx, `${uiDir}/uploaded.txt`)).toString()).toBe('real-browser-SFTP\n')
      await row.click({ button: 'right' })
      const downloaded = page.waitForEvent('download')
      await page.getByText('Download', { exact: true }).click()
      const download = await downloaded
      expect(download.suggestedFilename()).toBe('uploaded.txt')
      expect(await download.failure()).toBeNull()
      await row.click({ button: 'right' })
      await page.getByText('Renomear', { exact: true }).click()
      await page.getByLabel('Novo nome', { exact: true }).fill('renamed.txt')
      await page.getByRole('button', { name: 'Renomear', exact: true }).click()
      const renamed = page.locator('tbody tr').filter({ hasText: 'renamed.txt' })
      await renamed.waitFor()
      await renamed.click({ button: 'right' })
      await page.getByText('Excluir', { exact: true }).click()
      await page.locator('.n-dialog').getByRole('button', { name: 'Excluir', exact: true }).click()
      await page.getByText('Pasta vazia', { exact: true }).waitFor()
      expect((await service.list(...ctx, uiDir)).entries).toEqual([])
      expect(errors).toEqual([])
      await page.screenshot({ path: `${out}/completed.png`, fullPage: true })
      writeFileSync(`${out}/report.json`, JSON.stringify({ passed: true, transport: 'browser -> Fastify -> ssh2 -> OpenSSH', operations: ['upload', 'download', 'rename', 'delete'], authentication: 'fixture', auditPersistence: 'in-memory spy', errors }, null, 2))
    } finally { await context.close(); await browser.close() }
  }, 90_000)
})
