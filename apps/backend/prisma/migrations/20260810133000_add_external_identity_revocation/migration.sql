ALTER TABLE `external_identities`
  ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `revoked_at` DATETIME(3) NULL,
  ADD INDEX `external_identities_tenant_id_active_idx` (`tenant_id`, `active`);
