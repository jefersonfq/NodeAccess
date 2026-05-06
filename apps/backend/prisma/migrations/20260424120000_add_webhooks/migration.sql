CREATE TABLE `webhook_subscriptions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `target_url` VARCHAR(2048) NOT NULL,
  `http_method` VARCHAR(10) NOT NULL DEFAULT 'POST',
  `status` ENUM('ACTIVE', 'PAUSED', 'FAILED') NOT NULL DEFAULT 'ACTIVE',
  `subscribed_events_json` TEXT NOT NULL,
  `secret_encrypted` TEXT NULL,
  `secret_iv` VARCHAR(64) NULL,
  `headers_json` TEXT NULL,
  `payload_mode` ENUM('AUTOMATIC', 'CUSTOM') NOT NULL DEFAULT 'AUTOMATIC',
  `payload_template_json` TEXT NULL,
  `payload_schema_json` TEXT NULL,
  `timeout_ms` INTEGER NOT NULL DEFAULT 5000,
  `max_retries` INTEGER NOT NULL DEFAULT 5,
  `last_triggered_at` DATETIME(3) NULL,
  `last_success_at` DATETIME(3) NULL,
  `last_failure_at` DATETIME(3) NULL,
  `created_by_user_id` INTEGER NOT NULL,
  `updated_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `webhook_subscriptions_tenant_id_status_idx`(`tenant_id`, `status`),
  INDEX `webhook_subscriptions_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `webhook_deliveries` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `subscription_id` INTEGER NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `event_id` VARCHAR(64) NOT NULL,
  `event_type` VARCHAR(100) NOT NULL,
  `event_version` INTEGER NOT NULL,
  `resource_type` VARCHAR(60) NOT NULL,
  `resource_id` VARCHAR(64) NOT NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'DELIVERED', 'RETRY_SCHEDULED', 'DEAD') NOT NULL DEFAULT 'PENDING',
  `payload_json` LONGTEXT NOT NULL,
  `idempotency_key` VARCHAR(128) NOT NULL,
  `attempt_count` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NULL,
  `last_attempt_at` DATETIME(3) NULL,
  `response_status` INTEGER NULL,
  `response_latency_ms` INTEGER NULL,
  `response_body_snippet` VARCHAR(512) NULL,
  `last_error_code` VARCHAR(64) NULL,
  `last_error_message` VARCHAR(512) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `webhook_deliveries_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
  INDEX `webhook_deliveries_subscription_id_created_at_idx`(`subscription_id`, `created_at`),
  INDEX `webhook_deliveries_tenant_id_event_type_created_at_idx`(`tenant_id`, `event_type`, `created_at`),
  INDEX `webhook_deliveries_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `webhook_event_outbox` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `event_type` VARCHAR(100) NOT NULL,
  `event_version` INTEGER NOT NULL DEFAULT 1,
  `resource_type` VARCHAR(60) NOT NULL,
  `resource_id` VARCHAR(64) NOT NULL,
  `event_payload_json` LONGTEXT NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL,
  `correlation_id` VARCHAR(64) NULL,
  `processed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `webhook_event_outbox_processed_at_created_at_idx`(`processed_at`, `created_at`),
  INDEX `webhook_event_outbox_tenant_id_event_type_created_at_idx`(`tenant_id`, `event_type`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `webhook_subscriptions`
  ADD CONSTRAINT `webhook_subscriptions_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `webhook_subscriptions`
  ADD CONSTRAINT `webhook_subscriptions_created_by_user_id_fkey`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `webhook_subscriptions`
  ADD CONSTRAINT `webhook_subscriptions_updated_by_user_id_fkey`
    FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `webhook_deliveries`
  ADD CONSTRAINT `webhook_deliveries_subscription_id_fkey`
    FOREIGN KEY (`subscription_id`) REFERENCES `webhook_subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
