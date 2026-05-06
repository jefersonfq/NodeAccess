ALTER TABLE `sessions`
  ADD COLUMN `ended_reason` VARCHAR(191) NULL,
  ADD COLUMN `error_code` VARCHAR(191) NULL,
  ADD COLUMN `error_message` TEXT NULL;

CREATE INDEX `sessions_error_code_started_at_idx`
  ON `sessions`(`error_code`, `started_at`);
