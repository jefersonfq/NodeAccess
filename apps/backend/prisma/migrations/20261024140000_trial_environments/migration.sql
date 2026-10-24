-- CreateTable
CREATE TABLE `trial_profiles` (
    `id` INTEGER NOT NULL,
    `config_json` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trial_registrations` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(254) NULL,
    `name` VARCHAR(100) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING_EMAIL',
    `tenant_id` INTEGER NULL,
    `profile_json` JSON NOT NULL,
    `verification_hash` CHAR(64) NULL,
    `verification_expires_at` DATETIME(3) NULL,
    `management_hash` CHAR(64) NULL,
    `verified_at` DATETIME(3) NULL,
    `activated_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `marketing_consent` BOOLEAN NOT NULL DEFAULT false,
    `research_consent` BOOLEAN NOT NULL DEFAULT false,
    `privacy_version` VARCHAR(80) NOT NULL,
    `last_error` VARCHAR(80) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trial_registrations_email_key`(`email`),
    UNIQUE INDEX `trial_registrations_tenant_id_key`(`tenant_id`),
    UNIQUE INDEX `trial_registrations_verification_hash_key`(`verification_hash`),
    UNIQUE INDEX `trial_registrations_management_hash_key`(`management_hash`),
    INDEX `trial_registrations_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trial_consent_events` (
    `id` VARCHAR(36) NOT NULL,
    `trial_id` VARCHAR(36) NOT NULL,
    `participant_id` VARCHAR(36) NULL,
    `kind` VARCHAR(40) NOT NULL,
    `marketing` BOOLEAN NOT NULL,
    `research` BOOLEAN NOT NULL,
    `privacy_version` VARCHAR(80) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `trial_consent_events_trial_id_created_at_idx`(`trial_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trial_participants` (
    `id` VARCHAR(36) NOT NULL,
    `trial_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `verification_hash` CHAR(64) NULL,
    `verification_expires_at` DATETIME(3) NOT NULL,
    `management_hash` CHAR(64) NULL,
    `verified_at` DATETIME(3) NULL,
    `activated_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `user_id` INTEGER NULL,
    `marketing_consent` BOOLEAN NOT NULL DEFAULT false,
    `research_consent` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `trial_participants_verification_hash_key`(`verification_hash`),
    UNIQUE INDEX `trial_participants_management_hash_key`(`management_hash`),
    UNIQUE INDEX `trial_participants_user_id_key`(`user_id`),
    UNIQUE INDEX `trial_participants_trial_id_email_key`(`trial_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `trial_registrations` ADD CONSTRAINT `trial_registrations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trial_consent_events` ADD CONSTRAINT `trial_consent_events_trial_id_fkey` FOREIGN KEY (`trial_id`) REFERENCES `trial_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trial_participants` ADD CONSTRAINT `trial_participants_trial_id_fkey` FOREIGN KEY (`trial_id`) REFERENCES `trial_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
