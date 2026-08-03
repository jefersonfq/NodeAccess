#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

require('dotenv').config({ path: path.resolve(process.cwd(), 'apps/backend/.env') })
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@localhost:', '@127.0.0.1:')
}
process.chdir(path.resolve(process.cwd(), 'apps/backend'))

const { PrismaClient } = require('@prisma/client')

const INDEX_NAME = 'inventory_nodes_tenant_deleted_depth_name_idx'
const EXPECTED_COLUMNS = ['tenant_id', 'deleted_at', 'depth', 'name', 'id']
const REPOSITORY_PATH = path.resolve(
  process.cwd(),
  'src/modules/inventory/inventory.repository.ts',
)

function fail(message, details) {
  console.error(`[hosts-dependency-index-check] ${message}`)
  if (details !== undefined) {
    console.error(JSON.stringify(details, null, 2))
  }
  process.exitCode = 1
}

function readExplainJson(row) {
  const raw = row?.EXPLAIN ?? row?.explain ?? Object.values(row ?? {})[0]
  if (raw && typeof raw === 'object') {
    return raw
  }
  if (typeof raw !== 'string') {
    throw new Error(`EXPLAIN FORMAT=JSON did not return a JSON string. Columns: ${Object.keys(row ?? {}).join(', ')}`)
  }
  return JSON.parse(raw)
}

function findPlanTable(plan) {
  return plan?.query_block?.ordering_operation?.table
    ?? plan?.query_block?.table
    ?? null
}

async function main() {
  const source = fs.readFileSync(REPOSITORY_PATH, 'utf8')
  if (!source.includes(`FORCE INDEX (${INDEX_NAME})`)) {
    fail('InventoryRepository.findTree must force the tree order index.')
    return
  }

  const prisma = new PrismaClient()
  try {
    const indexRows = await prisma.$queryRawUnsafe(`
      SHOW INDEX FROM inventory_nodes WHERE Key_name = '${INDEX_NAME}'
    `)
    const actualColumns = indexRows
      .sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))
      .map((row) => row.Column_name)

    if (actualColumns.join(',') !== EXPECTED_COLUMNS.join(',')) {
      fail('Inventory tree order index has unexpected columns.', { actualColumns, expectedColumns: EXPECTED_COLUMNS })
      return
    }

    const explainRows = await prisma.$queryRawUnsafe(`
      EXPLAIN FORMAT=JSON
      SELECT
        id,
        tenant_id AS tenantId,
        parent_id AS parentId,
        type,
        host_id AS hostId,
        name,
        path,
        depth,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM inventory_nodes FORCE INDEX (${INDEX_NAME})
      WHERE tenant_id = 1
        AND deleted_at IS NULL
      ORDER BY depth ASC, name ASC, id ASC
    `)
    const plan = readExplainJson(explainRows[0])
    const table = findPlanTable(plan)
    const usingFilesort = Boolean(plan?.query_block?.ordering_operation?.using_filesort)

    if (usingFilesort || table?.key !== INDEX_NAME) {
      fail('Inventory tree query is not using the expected ordered index plan.', {
        key: table?.key,
        accessType: table?.access_type,
        rowsExaminedPerScan: table?.rows_examined_per_scan,
        usingFilesort,
      })
      return
    }

    console.log(JSON.stringify({
      ok: true,
      index: INDEX_NAME,
      columns: actualColumns,
      accessType: table?.access_type,
      rowsExaminedPerScan: table?.rows_examined_per_scan,
      usingFilesort,
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
