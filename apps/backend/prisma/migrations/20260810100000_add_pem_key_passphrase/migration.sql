ALTER TABLE `pem_keys`
  ADD COLUMN `encrypted_passphrase` LONGTEXT NULL,
  ADD COLUMN `passphrase_iv` VARCHAR(191) NULL;
