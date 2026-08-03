ALTER TABLE `licenses`
  ADD COLUMN `sftp_editor_block_on_mode_failure` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `sftp_editor_block_on_ownership_failure` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `sftp_editor_block_on_timestamp_failure` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `sftp_diff_max_bytes` INT NULL,
  ADD COLUMN `sftp_diff_max_lines` INT NULL;
