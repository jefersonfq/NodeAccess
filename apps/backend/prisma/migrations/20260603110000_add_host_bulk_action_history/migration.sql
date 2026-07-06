CREATE TABLE `host_bulk_action_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `tenant_id` INT NOT NULL,
  `actor_user_id` INT NOT NULL,
  `action_type` VARCHAR(40) NOT NULL,
  `action_label` VARCHAR(255) NOT NULL,
  `selection_json` JSON NOT NULL,
  `action_json` JSON NOT NULL,
  `requested` INT NOT NULL,
  `updated` INT NOT NULL,
  `skipped` INT NOT NULL,
  `failed` INT NOT NULL,
  `result_rows_json` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `host_bulk_hist_tenant_created_idx` (`tenant_id`, `created_at`),
  INDEX `host_bulk_hist_actor_created_idx` (`tenant_id`, `actor_user_id`, `created_at`),
  CONSTRAINT `host_bulk_action_history_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `host_bulk_action_history_actor_user_id_fkey`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
