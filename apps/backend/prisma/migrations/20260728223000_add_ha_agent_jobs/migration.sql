CREATE TABLE `ha_agent_jobs` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `node_id` VARCHAR(36) NOT NULL,
  `operation_id` VARCHAR(36) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `lease_hash` VARCHAR(64) NULL,
  `lease_expires_at` DATETIME(3) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `result_json` JSON NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `ha_agent_jobs_node_status_created_idx` (`node_id`, `status`, `created_at`),
  INDEX `ha_agent_jobs_operation_id_idx` (`operation_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ha_agent_jobs_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ha_agent_jobs_node_id_fkey`
    FOREIGN KEY (`node_id`) REFERENCES `ha_nodes` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ha_agent_jobs_operation_id_fkey`
    FOREIGN KEY (`operation_id`) REFERENCES `ha_operations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
