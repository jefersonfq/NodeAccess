CREATE TABLE `session_audits` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `session_id` INTEGER NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `host_id` INTEGER NOT NULL,
  `host_name_snapshot` VARCHAR(191) NOT NULL,
  `host_ip_snapshot` VARCHAR(191) NOT NULL,
  `connection_method` VARCHAR(191) NOT NULL,
  `ticket_provider` VARCHAR(191) NULL,
  `ticket_key` VARCHAR(191) NULL,
  `ticket_url` TEXT NULL,
  `started_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NULL,
  `status` ENUM('RUNNING', 'COMPLETED', 'FAILED', 'PURGED') NOT NULL DEFAULT 'RUNNING',
  `audit_enabled` BOOLEAN NOT NULL DEFAULT true,
  `storage_driver` VARCHAR(191) NOT NULL DEFAULT 'local',
  `chunk_count` INTEGER NOT NULL DEFAULT 0,
  `bytes_in` BIGINT NOT NULL DEFAULT 0,
  `bytes_out` BIGINT NOT NULL DEFAULT 0,
  `ai_summary_status` ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `ai_summary_text` LONGTEXT NULL,
  `ai_risk_level` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `session_audits_session_id_key`(`session_id`),
  INDEX `session_audits_tenant_id_started_at_idx`(`tenant_id`, `started_at`),
  INDEX `session_audits_user_id_started_at_idx`(`user_id`, `started_at`),
  INDEX `session_audits_host_id_started_at_idx`(`host_id`, `started_at`),
  INDEX `session_audits_ticket_key_idx`(`ticket_key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `session_audits`
  ADD CONSTRAINT `session_audits_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_audits`
  ADD CONSTRAINT `session_audits_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `session_audits`
  ADD CONSTRAINT `session_audits_host_id_fkey`
    FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
