ALTER TABLE `host_links`
  ADD COLUMN `token_encrypted` TEXT NULL,
  ADD COLUMN `token_iv` VARCHAR(64) NULL;

ALTER TABLE `shared_sessions`
  ADD COLUMN `token_encrypted` TEXT NULL,
  ADD COLUMN `token_iv` VARCHAR(64) NULL;
