import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfigFromFile } from '@prisma/config'

// Exercise Prisma's real loader: the security override changes its merge dependency.
test('Prisma loads nested configuration and resolves paths with the patched merger', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nodeaccess-prisma-config-'))
  try {
    await writeFile(join(directory, 'prisma.config.ts'), `export default {
      schema: './schema.prisma',
      migrations: { path: './migrations', seed: 'node ./seed.mjs' },
    }`)
    const loaded = await loadConfigFromFile({ configRoot: directory })
    assert.equal(loaded.error, undefined)
    assert.equal(loaded.config.schema, join(directory, 'schema.prisma'))
    assert.equal(loaded.config.migrations.path, join(directory, 'migrations'))
    assert.equal(loaded.config.migrations.seed, 'node ./seed.mjs')
    // A configuration error must remain an explicit failure, not silently use defaults.
    await writeFile(join(directory, 'broken.config.ts'), 'export default { invalid syntax')
    const broken = await loadConfigFromFile({ configRoot: directory, configFile: 'broken.config.ts' })
    assert.ok(broken.error)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
