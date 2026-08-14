ALTER TABLE `bastion_hosts`
  ADD COLUMN `source_host_id` INTEGER NULL;

CREATE UNIQUE INDEX `bastion_hosts_source_host_id_key`
  ON `bastion_hosts`(`source_host_id`);

ALTER TABLE `bastion_hosts`
  ADD CONSTRAINT `bastion_hosts_source_host_id_fkey`
  FOREIGN KEY (`source_host_id`) REFERENCES `hosts`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
