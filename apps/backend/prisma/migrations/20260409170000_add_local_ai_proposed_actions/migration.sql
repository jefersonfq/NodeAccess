CREATE TABLE `local_ai_proposed_actions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `requester_user_id` INTEGER NOT NULL,
  `reviewed_by_user_id` INTEGER NULL,
  `action_type` ENUM('TEST_HOST_CONNECTION') NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `target_type` VARCHAR(191) NOT NULL,
  `target_id` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `reason` TEXT NOT NULL,
  `risk_level` VARCHAR(191) NOT NULL DEFAULT 'low',
  `requires_approval` BOOLEAN NOT NULL DEFAULT true,
  `execution_enabled` BOOLEAN NOT NULL DEFAULT false,
  `review_note` TEXT NULL,
  `approved_at` DATETIME(3) NULL,
  `rejected_at` DATETIME(3) NULL,
  `expires_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `idx_lai_prop_tenant_status_created`(`tenant_id`, `status`, `created_at`),
  INDEX `idx_lai_prop_requester_created`(`requester_user_id`, `created_at`),
  INDEX `idx_lai_prop_reviewer_created`(`reviewed_by_user_id`, `created_at`),
  INDEX `idx_lai_prop_tenant_type_created`(`tenant_id`, `action_type`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `local_ai_proposed_actions`
  ADD CONSTRAINT `fk_lai_prop_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE `local_ai_proposed_actions`
  ADD CONSTRAINT `fk_lai_prop_requester`
    FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE `local_ai_proposed_actions`
  ADD CONSTRAINT `fk_lai_prop_reviewer`
    FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE;
