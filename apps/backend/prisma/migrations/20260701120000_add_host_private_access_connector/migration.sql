ALTER TABLE `hosts`
  ADD COLUMN `private_access_connector_id` INT NULL AFTER `connection_mode`;

CREATE INDEX `hosts_private_access_connector_idx`
  ON `hosts`(`tenant_id`, `private_access_connector_id`);
