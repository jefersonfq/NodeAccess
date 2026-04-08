-- AlterTable
ALTER TABLE `agents` MODIFY `token_hash` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `snippets` MODIFY `command` TEXT NOT NULL,
    MODIFY `description` TEXT NULL;

-- CreateTable
CREATE TABLE `port_forwardings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `host_id` INTEGER NOT NULL,
    `description` VARCHAR(255) NULL,
    `local_port` INTEGER NOT NULL,
    `remote_host` VARCHAR(191) NOT NULL,
    `remote_port` INTEGER NOT NULL,
    `auto_start` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `port_forwardings` ADD CONSTRAINT `port_forwardings_host_id_fkey` FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
