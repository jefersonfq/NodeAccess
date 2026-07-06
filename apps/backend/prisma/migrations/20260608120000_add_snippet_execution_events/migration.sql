CREATE TABLE `snippet_execution_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `snippet_id` INTEGER NULL,
  `host_id` INTEGER NULL,
  `session_id` INTEGER NULL,
  `execution_id` VARCHAR(64) NOT NULL,
  `source` ENUM('TERMINAL', 'MCP', 'API') NOT NULL DEFAULT 'TERMINAL',
  `status` ENUM('SENT', 'FAILED_SECRET_RESOLUTION', 'BLOCKED') NOT NULL DEFAULT 'SENT',
  `executed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `metadata_json` JSON NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `snippet_execution_events_tenant_execution_uidx` (`tenant_id`, `execution_id`),
  INDEX `snippet_execution_events_tenant_executed_idx` (`tenant_id`, `executed_at`),
  INDEX `snippet_execution_events_tenant_user_executed_idx` (`tenant_id`, `user_id`, `executed_at`),
  INDEX `snippet_execution_events_tenant_snippet_executed_idx` (`tenant_id`, `snippet_id`, `executed_at`),
  INDEX `snippet_execution_events_tenant_host_executed_idx` (`tenant_id`, `host_id`, `executed_at`),
  CONSTRAINT `snippet_execution_events_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `snippet_execution_events_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `snippet_execution_events_snippet_id_fkey`
    FOREIGN KEY (`snippet_id`) REFERENCES `snippets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `snippet_execution_events_host_id_fkey`
    FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `snippet_execution_events_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
