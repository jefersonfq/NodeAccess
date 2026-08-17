CREATE TABLE `local_ai_budget_counters` (
  `tenant_id` INTEGER NOT NULL,
  `period_month` DATE NOT NULL,
  `request_count` BIGINT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `period_month`),
  INDEX `local_ai_budget_counters_period_month_idx`(`period_month`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
