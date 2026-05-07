-- Add source and creator tracking to secrets
ALTER TABLE secrets
  ADD COLUMN created_by_user_id INT NULL,
  ADD COLUMN source ENUM('MANUAL','HOST_CONNECTION') NOT NULL DEFAULT 'MANUAL';

ALTER TABLE secrets
  ADD CONSTRAINT fk_secrets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_secrets_created_by ON secrets(created_by_user_id);

-- Backfill: for existing personal secrets, creator = owner
UPDATE secrets SET created_by_user_id = owner_user_id WHERE created_by_user_id IS NULL AND owner_user_id IS NOT NULL;
