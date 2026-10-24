CREATE TABLE `trial_notifications` (
  `id` VARCHAR(80) NOT NULL,
  `trial_id` VARCHAR(36) NOT NULL,
  `kind` VARCHAR(20) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `sent_at` DATETIME(3) NULL,
  `lease_until` DATETIME(3) NULL,
  `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `attempts` INTEGER NOT NULL DEFAULT 0,
  INDEX `trial_notifications_sent_at_next_attempt_at_idx` (`sent_at`, `next_attempt_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `trial_notifications_trial_id_fkey` FOREIGN KEY (`trial_id`) REFERENCES `trial_registrations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
