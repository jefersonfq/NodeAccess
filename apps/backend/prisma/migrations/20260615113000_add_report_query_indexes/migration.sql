CREATE INDEX `sessions_user_started_idx` ON `sessions`(`user_id`, `started_at`);

CREATE INDEX `sessions_host_started_idx` ON `sessions`(`host_id`, `started_at`);

CREATE INDEX `sessions_started_at_idx` ON `sessions`(`started_at`);

CREATE INDEX `admin_logs_target_id_action_time_idx` ON `admin_logs`(`target_type`, `target_id`, `action`, `timestamp`);

CREATE INDEX `webhook_deliv_tenant_sub_status_time_idx` ON `webhook_deliveries`(`tenant_id`, `subscription_id`, `status`, `created_at`);
