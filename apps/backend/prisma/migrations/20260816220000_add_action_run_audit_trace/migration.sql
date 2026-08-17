ALTER TABLE `ai_ssh_action_runs`
  ADD COLUMN `mcp_token_id` INTEGER NULL;

CREATE INDEX `ai_ssh_action_runs_mcp_token_id_created_at_idx`
  ON `ai_ssh_action_runs` (`mcp_token_id`, `created_at`);
