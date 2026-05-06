ALTER TABLE `licenses`
  ADD COLUMN `session_audit_enabled` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `session_audit_policies` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `mode` ENUM('DISABLED', 'ALL', 'USERS', 'GROUPS', 'MIXED') NOT NULL DEFAULT 'DISABLED',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `session_audit_policies_tenant_id_key`(`tenant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `session_audit_policy_users` (
  `policy_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`policy_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `session_audit_policy_groups` (
  `policy_id` INTEGER NOT NULL,
  `group_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`policy_id`, `group_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `session_audit_policies`
  ADD CONSTRAINT `session_audit_policies_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_audit_policy_users`
  ADD CONSTRAINT `session_audit_policy_users_policy_id_fkey`
  FOREIGN KEY (`policy_id`) REFERENCES `session_audit_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_audit_policy_users`
  ADD CONSTRAINT `session_audit_policy_users_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_audit_policy_groups`
  ADD CONSTRAINT `session_audit_policy_groups_policy_id_fkey`
  FOREIGN KEY (`policy_id`) REFERENCES `session_audit_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_audit_policy_groups`
  ADD CONSTRAINT `session_audit_policy_groups_group_id_fkey`
  FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
