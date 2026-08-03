#!/usr/bin/env node
/*
 * Static guard for HostsView inventory-tree key prefixes.
 *
 * The corporate inventory tree must not reuse `folder-{id}`, because that
 * prefix belongs to personal folders in the main hosts selection state.
 */

const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..', '..')
const hostsViewPath = path.join(repoRoot, 'apps/frontend/src/views/HostsView.vue')
const source = fs.readFileSync(hostsViewPath, 'utf8')

function assertContains(pattern, message) {
  if (!pattern.test(source)) {
    throw new Error(message)
  }
}

function assertNotContains(pattern, message) {
  if (pattern.test(source)) {
    throw new Error(message)
  }
}

assertContains(
  /key:\s*node\.type === 'HOST' \? `host-\$\{node\.hostId \?\? node\.id\}` : `inventory-folder-\$\{node\.id\}`/,
  'Corporate inventory tree folders must use inventory-folder-{id} keys.',
)

assertContains(
  /return \[`inventory-folder-\$\{selectedKey\.value\.replace\('inventory-', ''\)\}`\]/,
  'Selected corporate inventory tree key must map from inventory-{id} to inventory-folder-{id}.',
)

assertContains(
  /if \(key\.startsWith\('inventory-folder-'\)\) \{\s*search\.value = ''\s*selectedKey\.value = `inventory-\$\{key\.replace\('inventory-folder-', ''\)\}`/s,
  'Corporate inventory tree selection must map inventory-folder-{id} back to inventory-{id}.',
)

assertNotContains(
  /node\.type === 'HOST' \? `host-\$\{node\.hostId \?\? node\.id\}` : `folder-\$\{node\.id\}`/,
  'Corporate inventory tree must not emit folder-{id}; that collides with personal folders.',
)

console.log(JSON.stringify({
  ok: true,
  checked: path.relative(repoRoot, hostsViewPath),
  guard: 'corporate inventory tree keys do not collide with personal folder keys',
}, null, 2))
