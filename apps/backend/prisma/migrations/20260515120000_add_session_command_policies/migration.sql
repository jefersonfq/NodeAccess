CREATE TABLE `session_command_policy_groups` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `tenant_id` INT NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `priority` INT NOT NULL DEFAULT 0,
  `default_action` VARCHAR(32) NOT NULL DEFAULT 'allow',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  INDEX `session_command_policy_groups_tenant_enabled_priority_idx`(`tenant_id`, `enabled`, `priority`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `session_command_policy_rules` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `policy_group_id` INT NOT NULL,
  `type` VARCHAR(32) NOT NULL,
  `pattern` TEXT NOT NULL,
  `action` VARCHAR(32) NOT NULL DEFAULT 'block',
  `message` TEXT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `priority` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  INDEX `session_command_policy_rules_group_enabled_priority_idx`(`policy_group_id`, `enabled`, `priority`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `session_command_policy_bindings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `policy_group_id` INT NOT NULL,
  `target_type` VARCHAR(32) NOT NULL,
  `target_id` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `session_command_policy_bindings_unique_target`(`policy_group_id`, `target_type`, `target_id`),
  INDEX `session_command_policy_bindings_target_idx`(`target_type`, `target_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `session_command_policy_groups`
  ADD CONSTRAINT `session_command_policy_groups_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_command_policy_rules`
  ADD CONSTRAINT `session_command_policy_rules_policy_group_id_fkey`
  FOREIGN KEY (`policy_group_id`) REFERENCES `session_command_policy_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_command_policy_bindings`
  ADD CONSTRAINT `session_command_policy_bindings_policy_group_id_fkey`
  FOREIGN KEY (`policy_group_id`) REFERENCES `session_command_policy_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
