CREATE TABLE `mcp_interactive_ssh_sessions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(191) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `token_id` INTEGER NULL,
  `host_id` INTEGER NOT NULL,
  `host_name` VARCHAR(191) NOT NULL,
  `reason` TEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'open',
  `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NOT NULL,
  `closed_at` DATETIME(3) NULL,
  `close_reason` VARCHAR(64) NULL,
  `input_bytes` INTEGER NOT NULL DEFAULT 0,
  `output_bytes_read` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `mcp_interactive_ssh_sessions_session_id_key`(`session_id`),
  INDEX `mcp_interactive_ssh_sessions_tenant_status_idx`(`tenant_id`, `status`, `opened_at`),
  INDEX `mcp_interactive_ssh_sessions_token_status_idx`(`token_id`, `status`, `opened_at`),
  INDEX `mcp_interactive_ssh_sessions_host_opened_idx`(`host_id`, `opened_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `mcp_interactive_ssh_sessions`
  ADD CONSTRAINT `mcp_interactive_ssh_sessions_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `mcp_interactive_ssh_sessions`
  ADD CONSTRAINT `mcp_interactive_ssh_sessions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `mcp_interactive_ssh_sessions`
  ADD CONSTRAINT `mcp_interactive_ssh_sessions_token_id_fkey`
    FOREIGN KEY (`token_id`) REFERENCES `mcp_tokens`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `mcp_interactive_ssh_sessions`
  ADD CONSTRAINT `mcp_interactive_ssh_sessions_host_id_fkey`
    FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
