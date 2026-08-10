ALTER TABLE `tenant_auth_policies`
  ADD COLUMN `break_glass_user_id` INTEGER NULL,
  ADD COLUMN `break_glass_validated_at` DATETIME(3) NULL;

CREATE INDEX `tenant_auth_policies_break_glass_user_id_idx`
  ON `tenant_auth_policies`(`break_glass_user_id`);

ALTER TABLE `tenant_auth_policies`
  ADD CONSTRAINT `tenant_auth_policies_break_glass_user_id_fkey`
  FOREIGN KEY (`break_glass_user_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
