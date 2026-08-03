CREATE TABLE `resource_acl_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `inventory_node_id` INTEGER NOT NULL,
    `principal_type` ENUM('USER', 'GROUP', 'ROLE') NOT NULL,
    `principal_id` INTEGER NOT NULL,
    `can_view` BOOLEAN NOT NULL DEFAULT false,
    `can_connect` BOOLEAN NOT NULL DEFAULT false,
    `can_edit` BOOLEAN NOT NULL DEFAULT false,
    `can_admin` BOOLEAN NOT NULL DEFAULT false,
    `inherit_to_children` BOOLEAN NOT NULL DEFAULT true,
    `managed_by_legacy_scope` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `resource_acl_node_principal_key`(
        `inventory_node_id`,
        `principal_type`,
        `principal_id`
    ),
    INDEX `resource_acl_principal_idx`(`tenant_id`, `principal_type`, `principal_id`),
    INDEX `resource_acl_node_idx`(`tenant_id`, `inventory_node_id`),
    CONSTRAINT `resource_acl_has_permission_check` CHECK (
        `can_view` = true
        OR `can_connect` = true
        OR `can_edit` = true
        OR `can_admin` = true
    ),
    CONSTRAINT `resource_acl_role_id_check` CHECK (
        `principal_type` <> 'ROLE' OR `principal_id` IN (1, 2)
    ),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `resource_acl_entries`
    ADD CONSTRAINT `resource_acl_entries_tenant_id_fkey`
        FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `resource_acl_entries_inventory_node_id_fkey`
        FOREIGN KEY (`inventory_node_id`) REFERENCES `inventory_nodes`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `resource_acl_entries_created_by_id_fkey`
        FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant admins retain governance over the complete official tree.
INSERT INTO `resource_acl_entries` (
    `tenant_id`, `inventory_node_id`, `principal_type`, `principal_id`,
    `can_view`, `can_connect`, `can_edit`, `can_admin`, `inherit_to_children`,
    `created_by_id`, `updated_at`
)
SELECT
    root_node.`tenant_id`, root_node.`id`, 'ROLE', 2,
    true, true, true, true, true,
    MIN(admin_user.`id`), CURRENT_TIMESTAMP(3)
FROM `inventory_nodes` root_node
INNER JOIN `users` admin_user
    ON admin_user.`tenant_id` = root_node.`tenant_id`
   AND admin_user.`role` = 'ADMIN'
   AND admin_user.`deleted_at` IS NULL
WHERE root_node.`type` = 'ROOT'
GROUP BY root_node.`tenant_id`, root_node.`id`;

-- Preserve legacy host visibility while ACL becomes the source of security.
INSERT INTO `resource_acl_entries` (
    `tenant_id`, `inventory_node_id`, `principal_type`, `principal_id`,
    `can_view`, `can_connect`, `can_edit`, `can_admin`, `inherit_to_children`,
    `managed_by_legacy_scope`, `created_by_id`, `updated_at`
)
SELECT
    node.`tenant_id`, node.`id`,
    CASE host.`scope`
        WHEN 'GLOBAL' THEN 'ROLE'
        WHEN 'TEAM' THEN 'GROUP'
        ELSE 'USER'
    END,
    CASE host.`scope`
        WHEN 'GLOBAL' THEN 1
        WHEN 'TEAM' THEN host.`group_id`
        ELSE host.`owner_id`
    END,
    true,
    true,
    host.`scope` = 'PERSONAL',
    host.`scope` = 'PERSONAL',
    false,
    true,
    COALESCE(
        host.`owner_id`,
        (SELECT MIN(actor.`id`) FROM `users` actor
         WHERE actor.`tenant_id` = host.`tenant_id` AND actor.`deleted_at` IS NULL)
    ),
    CURRENT_TIMESTAMP(3)
FROM `inventory_nodes` node
INNER JOIN `hosts` host ON host.`id` = node.`host_id`
WHERE node.`type` = 'HOST'
  AND node.`deleted_at` IS NULL
  AND (
      host.`scope` = 'GLOBAL'
      OR (host.`scope` = 'TEAM' AND host.`group_id` IS NOT NULL)
      OR (host.`scope` = 'PERSONAL' AND host.`owner_id` IS NOT NULL)
  )
  AND EXISTS (
      SELECT 1 FROM `users` actor
      WHERE actor.`tenant_id` = host.`tenant_id` AND actor.`deleted_at` IS NULL
  );
