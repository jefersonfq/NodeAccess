-- CreateTable
CREATE TABLE `inbound_webhook_endpoints` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `provider` VARCHAR(60) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `endpoint_token_hash` VARCHAR(128) NOT NULL,
    `secret_encrypted` TEXT NULL,
    `secret_iv` VARCHAR(64) NULL,
    `status` ENUM('ACTIVE', 'PAUSED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `allowed_event_types_json` TEXT NOT NULL,
    `mapping_mode` ENUM('GENERIC', 'PROVIDER_ADAPTER') NOT NULL DEFAULT 'GENERIC',
    `created_by_user_id` INTEGER NOT NULL,
    `updated_by_user_id` INTEGER NULL,
    `last_received_at` DATETIME(3) NULL,
    `last_accepted_at` DATETIME(3) NULL,
    `last_rejected_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inwh_endpoints_token_hash_key`(`endpoint_token_hash`),
    INDEX `inwh_endpoints_tenant_status_idx`(`tenant_id`, `status`),
    INDEX `inwh_endpoints_tenant_provider_idx`(`tenant_id`, `provider`),
    INDEX `inwh_endpoints_tenant_created_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inbound_webhook_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `endpoint_id` INTEGER NOT NULL,
    `provider` VARCHAR(60) NOT NULL,
    `external_event_id` VARCHAR(128) NULL,
    `event_type` VARCHAR(120) NOT NULL,
    `idempotency_key` VARCHAR(160) NULL,
    `status` ENUM('RECEIVED', 'ACCEPTED', 'REJECTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED') NOT NULL DEFAULT 'RECEIVED',
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,
    `source_ip` VARCHAR(64) NULL,
    `signature_valid` BOOLEAN NOT NULL DEFAULT false,
    `payload_hash` VARCHAR(128) NOT NULL,
    `payload_json` LONGTEXT NOT NULL,
    `normalized_event_json` LONGTEXT NULL,
    `error_code` VARCHAR(64) NULL,
    `error_message` VARCHAR(512) NULL,
    `correlation_id` VARCHAR(128) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inwh_receipts_endpoint_idem_key`(`endpoint_id`, `idempotency_key`),
    INDEX `inwh_receipts_tenant_endpoint_received_idx`(`tenant_id`, `endpoint_id`, `received_at`),
    INDEX `inwh_receipts_tenant_status_received_idx`(`tenant_id`, `status`, `received_at`),
    INDEX `inwh_receipts_tenant_provider_event_idx`(`tenant_id`, `provider`, `external_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inbound_webhook_endpoints` ADD CONSTRAINT `inbound_webhook_endpoints_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inbound_webhook_endpoints` ADD CONSTRAINT `inbound_webhook_endpoints_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inbound_webhook_endpoints` ADD CONSTRAINT `inbound_webhook_endpoints_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inbound_webhook_receipts` ADD CONSTRAINT `inbound_webhook_receipts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inbound_webhook_receipts` ADD CONSTRAINT `inbound_webhook_receipts_endpoint_id_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `inbound_webhook_endpoints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
