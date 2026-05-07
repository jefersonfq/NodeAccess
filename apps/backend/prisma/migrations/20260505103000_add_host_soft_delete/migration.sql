ALTER TABLE `hosts`
  ADD COLUMN `deleted_at` DATETIME(3) NULL;

CREATE INDEX `hosts_tenant_id_deleted_at_idx`
  ON `hosts`(`tenant_id`, `deleted_at`);
