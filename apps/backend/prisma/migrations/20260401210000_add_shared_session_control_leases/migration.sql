CREATE TABLE `shared_session_control_leases` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `shared_session_id` INTEGER NOT NULL,
  `controller_user_id` INTEGER NOT NULL,
  `granted_by_user_id` INTEGER NOT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NULL,
  `end_reason` ENUM('REVOKED', 'EXPIRED', 'SESSION_ENDED', 'OWNER_DISCONNECTED', 'RELINQUISHED') NULL,
  `revoke_reason` VARCHAR(255) NULL,

  INDEX `shared_session_control_leases_shared_session_id_expires_at_idx`(`shared_session_id`, `expires_at`),
  INDEX `shared_session_control_leases_controller_user_id_started_at_idx`(`controller_user_id`, `started_at`),
  INDEX `shared_session_control_leases_granted_by_user_id_started_at_idx`(`granted_by_user_id`, `started_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shared_session_control_leases`
  ADD CONSTRAINT `shared_session_control_leases_shared_session_id_fkey`
    FOREIGN KEY (`shared_session_id`) REFERENCES `shared_sessions`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `shared_session_control_leases_controller_user_id_fkey`
    FOREIGN KEY (`controller_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `shared_session_control_leases_granted_by_user_id_fkey`
    FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
