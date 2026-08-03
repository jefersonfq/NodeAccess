ALTER TABLE `users`
  ADD COLUMN `avatar_mime_type` VARCHAR(64) NULL,
  ADD COLUMN `avatar_updated_at` DATETIME(3) NULL;
