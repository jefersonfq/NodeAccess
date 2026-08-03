CREATE TABLE `inventory_nodes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `root_tenant_id` INTEGER NULL,
    `parent_id` INTEGER NULL,
    `type` ENUM('ROOT', 'FOLDER', 'HOST') NOT NULL,
    `host_id` INTEGER NULL,
    `name` VARCHAR(120) NOT NULL,
    `path` VARCHAR(2048) NOT NULL,
    `depth` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` INTEGER NULL,
    `updated_by_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inventory_nodes_root_tenant_key`(`root_tenant_id`),
    UNIQUE INDEX `inventory_nodes_host_key`(`host_id`),
    INDEX `inventory_nodes_sibling_name_idx`(`tenant_id`, `parent_id`, `name`),
    INDEX `inventory_nodes_tree_idx`(`tenant_id`, `parent_id`, `deleted_at`, `name`),
    INDEX `inventory_nodes_path_idx`(`tenant_id`, `path`(512)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `inventory_nodes` (
    `tenant_id`,
    `root_tenant_id`,
    `type`,
    `name`,
    `path`,
    `depth`,
    `updated_at`
)
SELECT
    `id`,
    `id`,
    'ROOT',
    '__root__',
    '/',
    0,
    CURRENT_TIMESTAMP(3)
FROM `tenants`;

INSERT INTO `inventory_nodes` (
    `tenant_id`,
    `parent_id`,
    `type`,
    `host_id`,
    `name`,
    `path`,
    `depth`,
    `updated_at`
)
SELECT
    h.`tenant_id`,
    root_node.`id`,
    'HOST',
    h.`id`,
    h.`name`,
    '',
    1,
    CURRENT_TIMESTAMP(3)
FROM `hosts` h
INNER JOIN `inventory_nodes` root_node
    ON root_node.`root_tenant_id` = h.`tenant_id`
WHERE h.`deleted_at` IS NULL;

UPDATE `inventory_nodes`
SET `path` = CONCAT('/', `id`, '/')
WHERE `type` = 'HOST';

ALTER TABLE `inventory_nodes`
    ADD CONSTRAINT `inventory_nodes_tenant_id_fkey`
        FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `inventory_nodes_root_tenant_id_fkey`
        FOREIGN KEY (`root_tenant_id`) REFERENCES `tenants`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `inventory_nodes_parent_id_fkey`
        FOREIGN KEY (`parent_id`) REFERENCES `inventory_nodes`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `inventory_nodes_host_id_fkey`
        FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `inventory_nodes_created_by_id_fkey`
        FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `inventory_nodes_updated_by_id_fkey`
        FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;
