CREATE TABLE `shared_sessions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `host_id` INTEGER NOT NULL,
  `owner_user_id` INTEGER NOT NULL,
  `session_id` INTEGER NOT NULL,
  `status` ENUM('ACTIVE', 'ENDED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `join_token_hash` VARCHAR(191) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `shared_sessions_join_token_hash_key`(`join_token_hash`),
  INDEX `shared_sessions_tenant_id_status_expires_at_idx`(`tenant_id`, `status`, `expires_at`),
  INDEX `shared_sessions_session_id_status_idx`(`session_id`, `status`),
  INDEX `shared_sessions_owner_user_id_created_at_idx`(`owner_user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shared_session_participants` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `shared_session_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `role` ENUM('OWNER', 'VIEWER') NOT NULL,
  `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `left_at` DATETIME(3) NULL,
  `last_seen_at` DATETIME(3) NULL,

  UNIQUE INDEX `shared_session_participants_shared_session_id_user_id_key`(`shared_session_id`, `user_id`),
  INDEX `shared_session_participants_user_id_joined_at_idx`(`user_id`, `joined_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shared_sessions`
  ADD CONSTRAINT `shared_sessions_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `shared_sessions_host_id_fkey`
    FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `shared_sessions_owner_user_id_fkey`
    FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `shared_sessions_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `shared_session_participants`
  ADD CONSTRAINT `shared_session_participants_shared_session_id_fkey`
    FOREIGN KEY (`shared_session_id`) REFERENCES `shared_sessions`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `shared_session_participants_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
