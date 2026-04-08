CREATE TABLE `session_audit_ai_jobs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `session_audit_id` INTEGER NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `requested_by_user_id` INTEGER NULL,
  `kind` ENUM('SUMMARY') NOT NULL,
  `trigger_source` ENUM('AUTO_POST_SESSION', 'MANUAL', 'WINDOW') NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `model` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
  `prompt_version` VARCHAR(191) NULL,
  `error_message` TEXT NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `session_audit_ai_jobs_session_audit_id_kind_trigger_source_key`(`session_audit_id`, `kind`, `trigger_source`),
  INDEX `session_audit_ai_jobs_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
  INDEX `session_audit_ai_jobs_status_created_at_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `session_audit_ai_jobs`
  ADD CONSTRAINT `session_audit_ai_jobs_session_audit_id_fkey`
  FOREIGN KEY (`session_audit_id`) REFERENCES `session_audits`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
