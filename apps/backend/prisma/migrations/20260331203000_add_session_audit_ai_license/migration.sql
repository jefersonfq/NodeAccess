ALTER TABLE `licenses`
  ADD COLUMN `session_audit_ai_enabled` BOOLEAN NOT NULL DEFAULT false AFTER `session_audit_enabled`;
