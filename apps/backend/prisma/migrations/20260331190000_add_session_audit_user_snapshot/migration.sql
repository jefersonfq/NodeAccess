ALTER TABLE session_audits
  ADD COLUMN user_name_snapshot VARCHAR(191) NOT NULL DEFAULT '' AFTER user_id,
  ADD COLUMN user_email_snapshot VARCHAR(191) NULL AFTER user_name_snapshot;

UPDATE session_audits sa
LEFT JOIN users u ON u.id = sa.user_id
SET
  sa.user_name_snapshot = COALESCE(NULLIF(sa.user_name_snapshot, ''), u.name, CONCAT('user #', sa.user_id)),
  sa.user_email_snapshot = COALESCE(sa.user_email_snapshot, u.email);
