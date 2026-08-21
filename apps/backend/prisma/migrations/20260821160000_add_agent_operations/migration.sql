ALTER TABLE `agents`
  ADD COLUMN `maintenance_mode` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `drain_started_at` DATETIME(3) NULL,
  ADD COLUMN `pool_name` VARCHAR(120) NULL,
  ADD COLUMN `priority` INTEGER NOT NULL DEFAULT 100;

CREATE INDEX `agents_pool_priority_idx`
  ON `agents` (`tenant_id`, `pool_name`, `priority`, `active`, `maintenance_mode`);
