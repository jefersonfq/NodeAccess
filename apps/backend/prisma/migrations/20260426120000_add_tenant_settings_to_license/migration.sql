ALTER TABLE `licenses`
  ADD COLUMN `password_policy_min_length` INT NULL,
  ADD COLUMN `password_policy_regex`      VARCHAR(500) NULL,
  ADD COLUMN `password_policy_description` VARCHAR(255) NULL,
  ADD COLUMN `totp_issuer`               VARCHAR(100) NULL;
