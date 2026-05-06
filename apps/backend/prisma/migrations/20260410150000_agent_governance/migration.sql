ALTER TABLE `agents`
  ADD COLUMN `agent_mode`  ENUM('USER_BOUND', 'SERVICE_BOUND') NOT NULL DEFAULT 'USER_BOUND',
  ADD COLUMN `is_default`  TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `revoked_at`  DATETIME(3) NULL,
  ADD COLUMN `revoked_by`  INT NULL,
  ADD COLUMN `deleted_at`  DATETIME(3) NULL,
  ADD COLUMN `deleted_by`  INT NULL;

ALTER TABLE `agents`
  ADD CONSTRAINT `agents_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `agents_deleted_by_fkey` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
