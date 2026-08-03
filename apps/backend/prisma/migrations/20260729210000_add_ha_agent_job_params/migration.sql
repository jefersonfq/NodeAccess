ALTER TABLE `ha_agent_jobs`
  ADD COLUMN `params_json` JSON NULL AFTER `attempts`;
