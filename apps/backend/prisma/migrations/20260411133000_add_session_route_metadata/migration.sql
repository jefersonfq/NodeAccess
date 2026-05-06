ALTER TABLE `sessions`
  ADD COLUMN `requested_connection_mode` VARCHAR(191) NULL,
  ADD COLUMN `connection_method` VARCHAR(191) NOT NULL DEFAULT 'direct',
  ADD COLUMN `agent_id` INTEGER NULL,
  ADD COLUMN `agent_name_snapshot` VARCHAR(191) NULL,
  ADD COLUMN `agent_source` VARCHAR(191) NULL;

CREATE INDEX `sessions_connection_method_started_at_idx`
  ON `sessions`(`connection_method`, `started_at`);

CREATE INDEX `sessions_agent_id_started_at_idx`
  ON `sessions`(`agent_id`, `started_at`);
