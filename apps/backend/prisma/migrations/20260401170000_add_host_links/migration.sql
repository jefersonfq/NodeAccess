CREATE TABLE `host_links` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `host_id` INTEGER NOT NULL,
  `created_by_user_id` INTEGER NOT NULL,
  `token_hash` VARCHAR(191) NOT NULL,
  `type` ENUM('AUTHENTICATED', 'PUBLIC_ONCE') NOT NULL DEFAULT 'AUTHENTICATED',
  `expires_at` DATETIME(3) NOT NULL,
  `last_opened_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `host_links_token_hash_key`(`token_hash`),
  INDEX `host_links_tenant_id_host_id_expires_at_idx`(`tenant_id`, `host_id`, `expires_at`),
  INDEX `host_links_created_by_user_id_created_at_idx`(`created_by_user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `host_links`
  ADD CONSTRAINT `host_links_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `host_links`
  ADD CONSTRAINT `host_links_host_id_fkey`
    FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `host_links`
  ADD CONSTRAINT `host_links_created_by_user_id_fkey`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
