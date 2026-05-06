ALTER TABLE `sessions`
  ADD COLUMN `client_ip` VARCHAR(255) NULL,
  ADD COLUMN `user_agent` TEXT NULL,
  ADD COLUMN `agent_remote_ip` VARCHAR(255) NULL;

CREATE INDEX `sessions_client_ip_started_at_idx` ON `sessions`(`client_ip`, `started_at`);
CREATE INDEX `sessions_agent_remote_ip_started_at_idx` ON `sessions`(`agent_remote_ip`, `started_at`);
