ALTER TABLE `session_audits`
  ADD COLUMN `ai_summary_json` LONGTEXT NULL AFTER `ai_summary_text`;
