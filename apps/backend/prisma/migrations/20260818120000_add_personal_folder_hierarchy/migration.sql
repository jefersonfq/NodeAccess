ALTER TABLE `folders`
  ADD COLUMN `parent_id` INTEGER NULL;

CREATE INDEX `folders_tenant_user_parent_name_idx`
  ON `folders`(`tenant_id`, `user_id`, `parent_id`, `name`);

ALTER TABLE `folders`
  ADD CONSTRAINT `folders_parent_id_fkey`
  FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
