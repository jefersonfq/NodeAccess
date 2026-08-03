ALTER TABLE `ha_nodes`
  ADD COLUMN `owns_vip` BOOLEAN NOT NULL DEFAULT false AFTER `observed_role`,
  ADD COLUMN `virtual_ip` VARCHAR(100) NULL AFTER `owns_vip`;
