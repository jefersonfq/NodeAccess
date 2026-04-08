ALTER TABLE `bastion_hosts`
  ADD COLUMN `system_pem_key_id` INT NULL;

ALTER TABLE `bastion_hosts`
  ADD INDEX `bastion_hosts_system_pem_key_id_idx` (`system_pem_key_id`);

ALTER TABLE `bastion_hosts`
  ADD CONSTRAINT `bastion_hosts_system_pem_key_id_fkey`
  FOREIGN KEY (`system_pem_key_id`) REFERENCES `pem_keys`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
