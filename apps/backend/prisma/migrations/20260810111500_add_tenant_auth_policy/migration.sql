CREATE TABLE `tenant_auth_policies` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `local_login_enabled` BOOLEAN NOT NULL DEFAULT true,
  `sso_required` BOOLEAN NOT NULL DEFAULT false,
  `mfa_required` BOOLEAN NOT NULL DEFAULT true,
  `jit_provisioning_enabled` BOOLEAN NOT NULL DEFAULT false,
  `automatic_account_linking_enabled` BOOLEAN NOT NULL DEFAULT false,
  `email_tenant_discovery_enabled` BOOLEAN NOT NULL DEFAULT true,
  `lockout_max_attempts` INTEGER NULL,
  `lockout_duration_minutes` INTEGER NULL,
  `access_token_minutes` INTEGER NULL,
  `refresh_token_days` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `tenant_auth_policies_tenant_id_key`(`tenant_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `tenant_auth_policies_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
