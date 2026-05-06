ALTER TABLE `sessions`
  ADD COLUMN `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `sessions_active_last_seen_at_idx` ON `sessions`(`active`, `last_seen_at`);
