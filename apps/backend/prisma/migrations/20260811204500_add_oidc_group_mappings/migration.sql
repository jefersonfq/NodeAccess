ALTER TABLE `user_groups`
  ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN `external_identity_id` INTEGER NULL,
  ADD COLUMN `oidc_group_mapping_id` INTEGER NULL;

CREATE TABLE `oidc_group_mappings` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `external_group` VARCHAR(255) NOT NULL,
  `external_group_normalized` VARCHAR(255) NOT NULL,
  `group_id` INTEGER NOT NULL,
  `created_by_user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `oidc_group_mappings_tenant_id_external_group_normalized_key` (`tenant_id`, `external_group_normalized`),
  UNIQUE INDEX `oidc_group_mappings_tenant_id_group_id_key` (`tenant_id`, `group_id`),
  INDEX `oidc_group_mappings_created_by_user_id_idx` (`created_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `user_groups_external_identity_idx` ON `user_groups`(`external_identity_id`);
CREATE INDEX `user_groups_oidc_mapping_idx` ON `user_groups`(`oidc_group_mapping_id`);

ALTER TABLE `oidc_group_mappings`
  ADD CONSTRAINT `oidc_group_mappings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `oidc_group_mappings_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `oidc_group_mappings_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `user_groups`
  ADD CONSTRAINT `user_groups_external_identity_id_fkey` FOREIGN KEY (`external_identity_id`) REFERENCES `external_identities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `user_groups_oidc_group_mapping_id_fkey` FOREIGN KEY (`oidc_group_mapping_id`) REFERENCES `oidc_group_mappings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
