ALTER TABLE licenses
  ADD COLUMN shared_session_expiry_minutes_json JSON NULL,
  ADD COLUMN shared_session_max_expiry_minutes INT NULL;
