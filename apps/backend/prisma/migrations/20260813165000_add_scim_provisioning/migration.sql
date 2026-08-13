CREATE TABLE `scim_configs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `token_hash` CHAR(64) NULL,
  `token_prefix` VARCHAR(16) NULL,
  `rotated_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `scim_configs_tenant_id_key` (`tenant_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `scim_configs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `scim_users` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `external_id` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `scim_users_user_id_key` (`user_id`),
  UNIQUE INDEX `scim_users_tenant_id_external_id_key` (`tenant_id`, `external_id`),
  INDEX `scim_users_tenant_id_idx` (`tenant_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `scim_users_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `scim_users_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `scim_groups` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `group_id` INTEGER NOT NULL,
  `external_id` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `scim_groups_group_id_key` (`group_id`),
  UNIQUE INDEX `scim_groups_tenant_id_external_id_key` (`tenant_id`, `external_id`),
  INDEX `scim_groups_tenant_id_idx` (`tenant_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `scim_groups_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `scim_groups_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `scim_audit_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `action` VARCHAR(80) NOT NULL,
  `resource_type` VARCHAR(20) NOT NULL,
  `resource_id` VARCHAR(36) NOT NULL,
  `success` BOOLEAN NOT NULL DEFAULT true,
  `details` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `scim_audit_events_tenant_id_created_at_idx` (`tenant_id`, `created_at`),
  INDEX `scim_audit_events_tenant_id_resource_type_resource_id_idx` (`tenant_id`, `resource_type`, `resource_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `scim_audit_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
