ALTER TABLE `ai_ssh_action_run_steps`
  ADD COLUMN `timeout_seconds` INT NOT NULL DEFAULT 60 AFTER `command`;
