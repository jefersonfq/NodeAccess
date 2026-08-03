-- CreateTable
CREATE TABLE `host_personal_folders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `host_id` INTEGER NOT NULL,
    `folder_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `host_personal_folders_tenant_user_host_uniq`(`tenant_id`, `user_id`, `host_id`),
    INDEX `host_personal_folders_tenant_user_folder_idx`(`tenant_id`, `user_id`, `folder_id`),
    INDEX `host_personal_folders_host_idx`(`host_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill legacy host.folder_id as personal organization of the folder owner.
INSERT INTO `host_personal_folders` (`tenant_id`, `user_id`, `host_id`, `folder_id`)
SELECT h.`tenant_id`, f.`user_id`, h.`id`, h.`folder_id`
FROM `hosts` h
INNER JOIN `folders` f
  ON f.`id` = h.`folder_id`
 AND f.`tenant_id` = h.`tenant_id`
WHERE h.`folder_id` IS NOT NULL
ON DUPLICATE KEY UPDATE
  `folder_id` = VALUES(`folder_id`),
  `updated_at` = CURRENT_TIMESTAMP(3);

-- Stop treating personal organization as a global host attribute.
UPDATE `hosts`
SET `folder_id` = NULL
WHERE `folder_id` IS NOT NULL;

-- AddForeignKey
ALTER TABLE `host_personal_folders` ADD CONSTRAINT `host_personal_folders_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `host_personal_folders` ADD CONSTRAINT `host_personal_folders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `host_personal_folders` ADD CONSTRAINT `host_personal_folders_host_id_fkey` FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `host_personal_folders` ADD CONSTRAINT `host_personal_folders_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
