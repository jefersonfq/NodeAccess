ALTER TABLE `host_links`
  ADD COLUMN `pin_encrypted` TEXT NULL,
  ADD COLUMN `pin_iv` VARCHAR(64) NULL;
