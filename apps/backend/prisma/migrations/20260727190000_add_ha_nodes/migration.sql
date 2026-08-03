CREATE TABLE `ha_nodes` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `endpoint` VARCHAR(500) NULL,
  `desired_role` VARCHAR(20) NOT NULL DEFAULT 'STANDBY',
  `observed_role` VARCHAR(20) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `promotion_ready` BOOLEAN NOT NULL DEFAULT false,
  `blockers_json` JSON NULL,
  `components_json` JSON NULL,
  `enrollment_hash` VARCHAR(64) NOT NULL,
  `enrollment_expires` DATETIME(3) NOT NULL,
  `enrolled_at` DATETIME(3) NULL,
  `last_seen_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `ha_nodes_tenant_id_status_idx` (`tenant_id`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ha_nodes_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
