CREATE TABLE `tls_audit_events` (
  `id` VARCHAR(36) NOT NULL,
  `type` VARCHAR(64) NOT NULL,
  `domain` VARCHAR(253) NOT NULL,
  `actor` VARCHAR(100) NULL,
  `occurred_at` DATETIME(3) NOT NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `details` JSON NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `tls_audit_events_occurred_at_idx` (`occurred_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
