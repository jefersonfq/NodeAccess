CREATE TABLE `external_identities` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `provider_key` VARCHAR(80) NOT NULL,
  `issuer` VARCHAR(500) NOT NULL,
  `issuer_hash` CHAR(64) NOT NULL,
  `subject` VARCHAR(500) NOT NULL,
  `subject_hash` CHAR(64) NOT NULL,
  `email_at_link` VARCHAR(320) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `external_identities_tenant_id_issuer_hash_subject_hash_key`(`tenant_id`, `issuer_hash`, `subject_hash`),
  UNIQUE INDEX `external_identities_tenant_id_provider_key_user_id_key`(`tenant_id`, `provider_key`, `user_id`),
  INDEX `external_identities_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `external_identities_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `external_identities_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
