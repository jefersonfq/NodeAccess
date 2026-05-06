CREATE TABLE `email_configs` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `tenant_id`    INT          NOT NULL,
  `provider`     VARCHAR(20)  NOT NULL,
  `host`         VARCHAR(255) NULL,
  `port`         INT          NULL,
  `secure`       BOOLEAN      NOT NULL DEFAULT false,
  `user`         VARCHAR(255) NOT NULL,
  `password_enc` TEXT         NOT NULL,
  `password_iv`  VARCHAR(64)  NOT NULL,
  `from_name`    VARCHAR(100) NOT NULL,
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)  NOT NULL,

  UNIQUE INDEX `email_configs_tenant_id_key` (`tenant_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `email_configs`
  ADD CONSTRAINT `email_configs_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
