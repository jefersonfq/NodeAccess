CREATE TABLE `native_ssh_gateway_configs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `bind_host` VARCHAR(255) NOT NULL DEFAULT '0.0.0.0',
  `port` INTEGER NOT NULL DEFAULT 2222,
  `public_endpoint` VARCHAR(255) NULL,
  `host_key_path` VARCHAR(1000) NULL,
  `password_auth` BOOLEAN NOT NULL DEFAULT true,
  `mfa_required` BOOLEAN NOT NULL DEFAULT true,
  `public_key_auth` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `native_ssh_gateway_configs_tenant_id_key`(`tenant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `native_ssh_gateway_configs`
  ADD CONSTRAINT `native_ssh_gateway_configs_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
