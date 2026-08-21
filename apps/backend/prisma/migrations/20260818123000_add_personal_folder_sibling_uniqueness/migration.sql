ALTER TABLE `folders`
  ADD COLUMN `parent_key` INTEGER NOT NULL DEFAULT 0;

UPDATE `folders`
SET `parent_key` = COALESCE(`parent_id`, 0);

CREATE UNIQUE INDEX `folders_tenant_user_parent_name_uniq`
  ON `folders`(`tenant_id`, `user_id`, `parent_key`, `name`);
