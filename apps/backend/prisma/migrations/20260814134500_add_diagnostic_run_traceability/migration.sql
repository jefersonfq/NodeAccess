ALTER TABLE `diagnostic_runs`
  ADD COLUMN `origin_session_id` INT NULL AFTER `trigger_source`,
  ADD COLUMN `origin_ticket_key` VARCHAR(100) NULL AFTER `origin_session_id`,
  ADD COLUMN `origin_action_run_id` INT NULL AFTER `origin_ticket_key`;

CREATE INDEX `diagnostic_runs_tenant_origin_session_idx`
  ON `diagnostic_runs`(`tenant_id`, `origin_session_id`);

CREATE INDEX `diagnostic_runs_tenant_origin_ticket_idx`
  ON `diagnostic_runs`(`tenant_id`, `origin_ticket_key`);

CREATE INDEX `diagnostic_runs_tenant_origin_action_run_idx`
  ON `diagnostic_runs`(`tenant_id`, `origin_action_run_id`);
