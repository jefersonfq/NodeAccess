ALTER TABLE `hosts`
  ADD COLUMN `access_protocol` ENUM('SSH', 'RDP', 'TELNET', 'VNC', 'SERIAL') NOT NULL DEFAULT 'SSH';

CREATE INDEX `hosts_tenant_deleted_protocol_name_idx`
  ON `hosts`(`tenant_id`, `deleted_at`, `access_protocol`, `name`);
