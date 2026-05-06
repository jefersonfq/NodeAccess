-- Phase 2 tuning indexes
-- Conservative composite indexes based on current hot queries for sessions,
-- session audit, dashboard, and administrative logs.

CREATE INDEX `users_tenant_id_active_license_consumed_idx`
  ON `users`(`tenant_id`, `active`, `license_consumed`);

CREATE INDEX `users_tenant_id_created_at_idx`
  ON `users`(`tenant_id`, `created_at`);

CREATE INDEX `hosts_tenant_id_name_idx`
  ON `hosts`(`tenant_id`, `name`);

CREATE INDEX `hosts_tenant_id_ip_idx`
  ON `hosts`(`tenant_id`, `ip`);

CREATE INDEX `sessions_user_id_active_started_at_idx`
  ON `sessions`(`user_id`, `active`, `started_at`);

CREATE INDEX `sessions_host_id_active_idx`
  ON `sessions`(`host_id`, `active`);

CREATE INDEX `sessions_active_started_at_idx`
  ON `sessions`(`active`, `started_at`);

CREATE INDEX `session_audits_tenant_id_status_started_at_idx`
  ON `session_audits`(`tenant_id`, `status`, `started_at`);

CREATE INDEX `session_audits_tenant_id_ticket_key_idx`
  ON `session_audits`(`tenant_id`, `ticket_key`);

CREATE INDEX `session_audit_ai_jobs_session_audit_id_created_at_idx`
  ON `session_audit_ai_jobs`(`session_audit_id`, `created_at`);

CREATE INDEX `session_audit_ai_jobs_kind_status_created_at_idx`
  ON `session_audit_ai_jobs`(`kind`, `status`, `created_at`);

CREATE INDEX `auth_logs_user_id_timestamp_idx`
  ON `auth_logs`(`user_id`, `timestamp`);

CREATE INDEX `auth_logs_event_type_success_timestamp_idx`
  ON `auth_logs`(`event_type`, `success`, `timestamp`);

CREATE INDEX `admin_logs_admin_id_timestamp_idx`
  ON `admin_logs`(`admin_id`, `timestamp`);
