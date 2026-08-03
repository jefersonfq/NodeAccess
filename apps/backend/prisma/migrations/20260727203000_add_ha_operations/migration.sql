CREATE TABLE `ha_operations` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `node_id` VARCHAR(36) NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `current_stage` VARCHAR(50) NOT NULL,
  `steps_json` JSON NOT NULL,
  `error_layer` VARCHAR(50) NULL,
  `error_message` VARCHAR(1000) NULL,
  `initiated_by_id` INTEGER NOT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `ha_operations_tenant_id_created_at_idx` (`tenant_id`, `created_at`),
  INDEX `ha_operations_node_id_created_at_idx` (`node_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ha_operations_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ha_operations_node_id_fkey`
    FOREIGN KEY (`node_id`) REFERENCES `ha_nodes` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
