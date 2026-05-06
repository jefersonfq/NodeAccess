CREATE INDEX `session_audit_ai_jobs_session_audit_id_idx`
  ON `session_audit_ai_jobs`(`session_audit_id`);

ALTER TABLE `session_audit_ai_jobs`
  DROP INDEX `session_audit_ai_jobs_session_audit_id_kind_trigger_source_key`;

CREATE TABLE `session_audit_ai_artifacts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `session_audit_id` INTEGER NOT NULL,
  `job_id` INTEGER NOT NULL,
  `template` VARCHAR(191) NOT NULL,
  `summary_text` LONGTEXT NOT NULL,
  `summary_json` LONGTEXT NOT NULL,
  `risk_level` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `session_audit_ai_artifacts_session_audit_id_created_at_idx`(`session_audit_id`, `created_at`),
  INDEX `session_audit_ai_artifacts_job_id_idx`(`job_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `session_audit_ai_artifacts`
  ADD CONSTRAINT `session_audit_ai_artifacts_session_audit_id_fkey`
  FOREIGN KEY (`session_audit_id`) REFERENCES `session_audits`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_audit_ai_artifacts`
  ADD CONSTRAINT `session_audit_ai_artifacts_job_id_fkey`
  FOREIGN KEY (`job_id`) REFERENCES `session_audit_ai_jobs`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
