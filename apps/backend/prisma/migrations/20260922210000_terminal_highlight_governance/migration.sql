CREATE TABLE `terminal_highlight_group_assignments` (
  `template_id` INTEGER NOT NULL,
  `group_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`template_id`, `group_id`),
  INDEX `terminal_highlight_group_assignments_group_id_template_id_idx` (`group_id`, `template_id`),
  CONSTRAINT `terminal_highlight_group_assignments_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `terminal_highlight_templates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `terminal_highlight_group_assignments_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `terminal_highlight_template_versions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `template_id` INTEGER NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `active` BOOLEAN NOT NULL,
  `rules_json` JSON NOT NULL,
  `user_ids_json` JSON NOT NULL,
  `group_ids_json` JSON NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `terminal_highlight_template_versions_template_id_version_key` (`template_id`, `version`),
  INDEX `terminal_highlight_template_versions_tenant_id_created_at_idx` (`tenant_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `terminal_highlight_template_versions_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `terminal_highlight_templates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `terminal_highlight_template_versions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `terminal_highlight_template_versions_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `terminal_highlight_telemetry` ADD COLUMN `matched_rule_ids` JSON NULL;
