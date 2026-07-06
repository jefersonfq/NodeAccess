ALTER TABLE `session_audits`
  ADD COLUMN `command_count` INTEGER NULL;

CREATE INDEX `session_audits_tenant_id_command_count_started_at_idx`
  ON `session_audits`(`tenant_id`, `command_count`, `started_at`);
