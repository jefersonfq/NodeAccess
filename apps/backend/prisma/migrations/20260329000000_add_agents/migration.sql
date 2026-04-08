CREATE TABLE `agents` (
    `id`           INT          NOT NULL AUTO_INCREMENT,
    `tenant_id`    INT          NOT NULL,
    `created_by`   INT          NOT NULL,
    `name`         VARCHAR(191) NOT NULL,
    `token_hash`   LONGTEXT     NOT NULL,
    `active`       BOOLEAN      NOT NULL DEFAULT true,
    `last_seen_at` DATETIME(3)  NULL,
    `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`   DATETIME(3)  NOT NULL,
    PRIMARY KEY (`id`),
    INDEX `agents_tenant_id_fkey` (`tenant_id`),
    INDEX `agents_created_by_fkey` (`created_by`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `agents`
    ADD CONSTRAINT `agents_tenant_id_fkey`
        FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `agents`
    ADD CONSTRAINT `agents_created_by_fkey`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;
