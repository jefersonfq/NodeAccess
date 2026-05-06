ALTER TABLE `agents`
  ADD COLUMN `last_agent_version` VARCHAR(191) NULL,
  ADD COLUMN `last_agent_hostname` VARCHAR(191) NULL,
  ADD COLUMN `last_agent_platform` VARCHAR(191) NULL,
  ADD COLUMN `last_agent_arch` VARCHAR(191) NULL,
  ADD COLUMN `last_agent_remote_ip` VARCHAR(191) NULL,
  ADD COLUMN `last_agent_connected_at` DATETIME(3) NULL,
  ADD COLUMN `last_agent_disconnected_at` DATETIME(3) NULL,
  ADD COLUMN `last_agent_disconnect_reason` TEXT NULL;
