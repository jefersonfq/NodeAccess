-- Additive migration: preserve history; prefer a delivered winner to avoid resending known success.
ALTER TABLE jira_outbox_events ADD COLUMN claim_token VARCHAR(36) NULL, ADD COLUMN lease_until DATETIME(3) NULL;
ALTER TABLE webhook_deliveries ADD COLUMN claim_token VARCHAR(36) NULL, ADD COLUMN lease_until DATETIME(3) NULL, ADD COLUMN deduplication_key VARCHAR(128) NULL;
UPDATE webhook_deliveries d
JOIN (SELECT idempotency_key, COALESCE(MIN(CASE WHEN status = 'DELIVERED' THEN id END), MIN(id)) AS keep_id FROM webhook_deliveries GROUP BY idempotency_key) original
  ON d.id = original.keep_id
SET d.deduplication_key = d.idempotency_key;
-- Keep duplicate records for audit, but suppress remaining unsent copies.
UPDATE webhook_deliveries d
JOIN (SELECT idempotency_key, COALESCE(MIN(CASE WHEN status = 'DELIVERED' THEN id END), MIN(id)) AS keep_id FROM webhook_deliveries GROUP BY idempotency_key) original
  ON d.idempotency_key = original.idempotency_key AND d.id <> original.keep_id
SET d.status = 'DEAD', d.last_error_code = 'LEGACY_DUPLICATE', d.last_error_message = 'Historical duplicate preserved, automatic sending suppressed'
WHERE d.status IN ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED');
CREATE UNIQUE INDEX webhook_deliveries_deduplication_key_key ON webhook_deliveries(deduplication_key);
CREATE INDEX webhook_deliveries_status_lease_until_idx ON webhook_deliveries(status, lease_until);
CREATE INDEX jira_outbox_events_status_lease_until_idx ON jira_outbox_events(status, lease_until);
