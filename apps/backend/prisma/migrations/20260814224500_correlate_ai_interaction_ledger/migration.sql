ALTER TABLE `ai_interactions`
  ADD COLUMN `estimated_usd_micros` BIGINT NULL,
  ADD COLUMN `script_artifact_id` INTEGER NULL,
  ADD COLUMN `action_run_id` INTEGER NULL;
CREATE INDEX `ai_interactions_script_artifact_id_idx` ON `ai_interactions` (`script_artifact_id`);
CREATE INDEX `ai_interactions_action_run_id_idx` ON `ai_interactions` (`action_run_id`);

ALTER TABLE `ai_script_artifacts`
  ADD COLUMN `interaction_correlation_id` VARCHAR(36) NULL;
CREATE INDEX `ai_script_artifacts_interaction_correlation_id_idx` ON `ai_script_artifacts` (`interaction_correlation_id`);
