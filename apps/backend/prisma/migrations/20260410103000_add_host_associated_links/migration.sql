CREATE TABLE `host_associated_links` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `host_id` INTEGER NOT NULL,
  `label` VARCHAR(120) NOT NULL,
  `url_template` VARCHAR(2000) NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `open_mode` ENUM('NEW_TAB', 'SAME_TAB') NOT NULL DEFAULT 'NEW_TAB',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `idx_host_assoc_links_tenant_host_enabled_pos`(`tenant_id`, `host_id`, `enabled`, `position`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `host_associated_links`
  ADD CONSTRAINT `host_associated_links_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `host_associated_links`
  ADD CONSTRAINT `host_associated_links_host_id_fkey`
    FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
