import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { JiraInteractionRepository } from '../../apps/backend/src/modules/integrations/jira-interaction.repository.js'
import { WebhookRepository } from '../../apps/backend/src/modules/webhooks/webhook.repository.js'
const url = process.env.HARDENING_DATABASE_URL
if (!url?.startsWith('mysql://root:hardening-test-only@127.0.0.1:3308/hardening')) throw new Error('Disposable DB required')
const db = new PrismaClient({ datasources: { db: { url } } })
const [kind, row] = process.argv.slice(2)
const token = randomUUID()
const claimed = kind === 'jira' ? await new JiraInteractionRepository(db).claimOutbox(Number(row), token) : await new WebhookRepository(db).claimDelivery(Number(row), token, 30000)
if (!claimed) throw new Error('Claim failed')
process.send?.({ claimed: true, token })
// Parent kills this process abruptly. No cleanup or lease release is possible.
setInterval(() => {}, 1000)
