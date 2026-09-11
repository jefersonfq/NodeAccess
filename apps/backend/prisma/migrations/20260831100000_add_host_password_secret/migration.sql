ALTER TABLE `hosts`
  ADD COLUMN `password_secret_id` INTEGER NULL AFTER `password_encrypted`,
  ADD INDEX `hosts_password_secret_id_idx` (`password_secret_id`),
  ADD CONSTRAINT `hosts_password_secret_id_fkey`
    FOREIGN KEY (`password_secret_id`) REFERENCES `secrets` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
