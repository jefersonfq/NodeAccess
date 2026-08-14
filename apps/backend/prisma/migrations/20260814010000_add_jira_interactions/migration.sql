CREATE TABLE `jira_interactions` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `host_id` INTEGER NOT NULL,
  `ticket_key` VARCHAR(100) NULL,
  `ticket_url` TEXT NULL,
  `ticket_summary` TEXT NULL,
  `ticket_status` VARCHAR(120) NULL,
  `state` VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  `break_glass` BOOLEAN NOT NULL DEFAULT false,
  `break_glass_reason` TEXT NULL,
  `explicitly_closed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `jira_interactions_tenant_user_state_idx` (`tenant_id`, `user_id`, `state`),
  INDEX `jira_interactions_tenant_ticket_idx` (`tenant_id`, `ticket_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `jira_interaction_sessions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `interaction_id` VARCHAR(64) NOT NULL,
  `session_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `jira_interaction_sessions_session_id_key` (`session_id`),
  INDEX `jira_interaction_sessions_interaction_id_idx` (`interaction_id`),
  CONSTRAINT `jira_interaction_sessions_interaction_id_fkey` FOREIGN KEY (`interaction_id`) REFERENCES `jira_interactions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `jira_interaction_sessions_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `jira_outbox_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `interaction_id` VARCHAR(64) NOT NULL,
  `action` VARCHAR(40) NOT NULL,
  `idempotency_key` VARCHAR(190) NOT NULL,
  `payload_json` JSON NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_error` TEXT NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `jira_outbox_events_idempotency_key_key` (`idempotency_key`),
  INDEX `jira_outbox_events_status_next_attempt_idx` (`status`, `next_attempt_at`),
  INDEX `jira_outbox_events_tenant_interaction_idx` (`tenant_id`, `interaction_id`),
  CONSTRAINT `jira_outbox_events_interaction_id_fkey` FOREIGN KEY (`interaction_id`) REFERENCES `jira_interactions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
