ALTER TABLE `hosts`
  ADD COLUMN `trusted_host_key_fingerprint` VARCHAR(255) NULL,
  ADD COLUMN `trusted_host_key_verified_at` DATETIME(3) NULL,
  ADD COLUMN `trusted_host_key_verified_by` INTEGER NULL;
