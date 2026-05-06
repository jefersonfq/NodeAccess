CREATE TABLE `mcp_tokens` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `created_by` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `token_hash` TEXT NOT NULL,
  `allowed_capabilities_json` JSON NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `expires_at` DATETIME(3) NULL,
  `last_used_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `revoked_by` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `mcp_tokens_token_hash_key`(`token_hash`(191)),
  INDEX `mcp_tokens_tenant_id_active_revoked_at_idx`(`tenant_id`, `active`, `revoked_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `mcp_tokens`
  ADD CONSTRAINT `mcp_tokens_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `mcp_tokens`
  ADD CONSTRAINT `mcp_tokens_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `mcp_tokens`
  ADD CONSTRAINT `mcp_tokens_revoked_by_fkey`
    FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
