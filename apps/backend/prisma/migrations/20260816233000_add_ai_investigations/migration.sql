CREATE TABLE `ai_investigations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `host_id` INTEGER NOT NULL,
  `requested_by_id` INTEGER NOT NULL,
  `mcp_token_id` INTEGER NULL,
  `objective` VARCHAR(500) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  `expires_at` DATETIME(3) NOT NULL,
  `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closed_at` DATETIME(3) NULL,
  `close_reason` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_investigations_tenant_status_activity_idx` (`tenant_id`, `status`, `last_activity_at`),
  INDEX `ai_investigations_host_created_idx` (`host_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_investigation_reports` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `investigation_id` INTEGER NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `provider` VARCHAR(80) NULL,
  `model` VARCHAR(160) NULL,
  `summary` LONGTEXT NOT NULL,
  `facts_json` JSON NOT NULL,
  `hypotheses_json` JSON NOT NULL,
  `risks_json` JSON NOT NULL,
  `recommendations_json` JSON NOT NULL,
  `actions_json` JSON NOT NULL,
  `evidence_json` JSON NOT NULL,
  `redaction_applied` BOOLEAN NOT NULL DEFAULT false,
  `checksum` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_investigation_reports_investigation_created_idx` (`investigation_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_investigation_reports_investigation_fkey` FOREIGN KEY (`investigation_id`) REFERENCES `ai_investigations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ai_investigation_reports_creator_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_ssh_action_runs` ADD COLUMN `investigation_id` INTEGER NULL;
CREATE INDEX `ai_ssh_action_runs_investigation_created_idx` ON `ai_ssh_action_runs` (`investigation_id`, `created_at`);
ALTER TABLE `ai_ssh_action_runs` ADD CONSTRAINT `ai_ssh_action_runs_investigation_fkey` FOREIGN KEY (`investigation_id`) REFERENCES `ai_investigations` (`id`) ON DELETE SET NULL;
