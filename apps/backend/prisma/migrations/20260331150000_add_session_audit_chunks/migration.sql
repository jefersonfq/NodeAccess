CREATE TABLE `session_audit_chunks` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `session_audit_id` INTEGER NOT NULL,
  `seq` INTEGER NOT NULL,
  `started_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NOT NULL,
  `event_count` INTEGER NOT NULL DEFAULT 0,
  `storage_key` TEXT NOT NULL,
  `compression` VARCHAR(191) NOT NULL DEFAULT 'none',
  `compressed_size` BIGINT NOT NULL DEFAULT 0,
  `raw_size` BIGINT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `session_audit_chunks_session_audit_id_seq_key`(`session_audit_id`, `seq`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `session_audit_chunks`
  ADD CONSTRAINT `session_audit_chunks_session_audit_id_fkey`
    FOREIGN KEY (`session_audit_id`) REFERENCES `session_audits`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
