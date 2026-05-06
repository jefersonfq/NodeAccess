CREATE TABLE `secrets` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `alias` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `scope` ENUM('PERSONAL', 'GROUP', 'TENANT') NOT NULL DEFAULT 'PERSONAL',
  `owner_user_id` INTEGER NULL,
  `group_id` INTEGER NULL,
  `encrypted_value` LONGTEXT NOT NULL,
  `iv` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `rotated_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,

  UNIQUE INDEX `secrets_tenant_id_alias_key`(`tenant_id`, `alias`),
  INDEX `secrets_tenant_id_scope_revoked_at_idx`(`tenant_id`, `scope`, `revoked_at`),
  INDEX `secrets_owner_user_id_idx`(`owner_user_id`),
  INDEX `secrets_group_id_idx`(`group_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `secrets`
  ADD CONSTRAINT `secrets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `secrets_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `secrets_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
