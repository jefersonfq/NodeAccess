CREATE TABLE `session_audit_reconstructions` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `session_id` INTEGER NOT NULL,
  `processor_version` VARCHAR(64) NOT NULL,
  `source_fingerprint` CHAR(64) NOT NULL,
  `metadata` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `audit_reconstruction_source_key` (`session_id`, `processor_version`, `source_fingerprint`),
  INDEX `audit_reconstruction_tenant_session_idx` (`tenant_id`, `session_id`, `created_at`),
  CONSTRAINT `audit_reconstruction_session_fk` FOREIGN KEY (`session_id`) REFERENCES `session_audits` (`session_id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `session_audit_derived_commands` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `run_id` VARCHAR(64) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `command_index` INTEGER NOT NULL,
  `command_text` LONGTEXT NOT NULL,
  `payload` JSON NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `audit_derived_run_command_key` (`run_id`, `command_index`),
  INDEX `audit_derived_tenant_run_idx` (`tenant_id`, `run_id`, `command_index`),
  FULLTEXT INDEX `audit_derived_command_search_idx` (`command_text`),
  CONSTRAINT `audit_derived_run_fk` FOREIGN KEY (`run_id`) REFERENCES `session_audit_reconstructions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
