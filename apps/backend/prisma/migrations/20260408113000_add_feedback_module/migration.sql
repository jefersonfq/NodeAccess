CREATE TABLE `feedbacks` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `type` ENUM('SUGGESTION', 'PROBLEM', 'QUESTION') NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `status` ENUM('NEW', 'IN_REVIEW', 'ACCEPTED', 'NOT_PLANNED', 'COMPLETED') NOT NULL DEFAULT 'NEW',
  `admin_response` TEXT NULL,
  `context_route` VARCHAR(191) NULL,
  `context_screen` VARCHAR(191) NULL,
  `closed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `feedbacks_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
  INDEX `feedbacks_user_id_created_at_idx`(`user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `feedbacks`
  ADD CONSTRAINT `feedbacks_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `feedbacks`
  ADD CONSTRAINT `feedbacks_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
