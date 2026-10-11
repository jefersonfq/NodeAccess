CREATE TABLE `terminal_highlight_templates` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `rules_json` JSON NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `version` INTEGER NOT NULL DEFAULT 1,
  `created_by_user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `terminal_highlight_templates_tenant_id_name_key` (`tenant_id`, `name`),
  INDEX `terminal_highlight_templates_tenant_id_active_idx` (`tenant_id`, `active`),
  PRIMARY KEY (`id`),
  CONSTRAINT `terminal_highlight_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `terminal_highlight_templates_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `terminal_highlight_assignments` (
  `template_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `terminal_highlight_assignments_user_id_template_id_idx` (`user_id`, `template_id`),
  PRIMARY KEY (`template_id`, `user_id`),
  CONSTRAINT `terminal_highlight_assignments_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `terminal_highlight_templates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `terminal_highlight_assignments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `terminal_highlight_preferences` (
  `user_id` INTEGER NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `rules_json` JSON NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `terminal_highlight_preferences_tenant_id_idx` (`tenant_id`),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `terminal_highlight_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `terminal_highlight_preferences_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `terminal_highlight_telemetry` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `template_id` INTEGER NULL,
  `duration_ms` DOUBLE NOT NULL,
  `bytes_processed` INTEGER NOT NULL,
  `match_count` INTEGER NOT NULL,
  `rule_count` INTEGER NOT NULL,
  `budget_exceeded` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `terminal_highlight_telemetry_tenant_id_created_at_idx` (`tenant_id`, `created_at`),
  INDEX `terminal_highlight_telemetry_template_id_created_at_idx` (`template_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `terminal_highlight_telemetry_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `terminal_highlight_telemetry_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `terminal_highlight_telemetry_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `terminal_highlight_templates` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
