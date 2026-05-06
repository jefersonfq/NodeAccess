ALTER TABLE `licenses`
  ADD COLUMN `session_audit_ai_provider` VARCHAR(32) NOT NULL DEFAULT 'automatic' AFTER `session_audit_ai_enabled`;

