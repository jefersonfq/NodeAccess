-- Additional audit indexes for high-volume list filters and AI job recovery.
-- These target metadata queries only; raw audit chunks remain append-oriented.

CREATE INDEX `session_audits_tenant_id_host_id_started_at_idx`
  ON `session_audits`(`tenant_id`, `host_id`, `started_at`);

CREATE INDEX `session_audits_tenant_id_user_id_started_at_idx`
  ON `session_audits`(`tenant_id`, `user_id`, `started_at`);

CREATE INDEX `session_audits_tenant_id_ai_risk_level_started_at_idx`
  ON `session_audits`(`tenant_id`, `ai_risk_level`, `started_at`);

CREATE INDEX `session_audit_ai_jobs_kind_status_started_at_idx`
  ON `session_audit_ai_jobs`(`kind`, `status`, `started_at`);
