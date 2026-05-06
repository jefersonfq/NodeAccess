-- CreateTable: snippet_groups
CREATE TABLE `snippet_groups` (
  `id`          INTEGER      NOT NULL AUTO_INCREMENT,
  `tenant_id`   INTEGER      NOT NULL,
  `created_by`  INTEGER      NOT NULL,
  `name`        VARCHAR(100) NOT NULL,
  `description` VARCHAR(500) NULL,
  `scope`       ENUM('PERSONAL','TEAM') NOT NULL DEFAULT 'PERSONAL',
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `snippet_groups_tenant_id_idx`(`tenant_id`),
  INDEX `snippet_groups_created_by_idx`(`created_by`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddColumn: snippets.group_id
ALTER TABLE `snippets` ADD COLUMN `group_id` INTEGER NULL;

-- AddForeignKey: snippet_groups → tenants
ALTER TABLE `snippet_groups`
  ADD CONSTRAINT `snippet_groups_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: snippet_groups → users
ALTER TABLE `snippet_groups`
  ADD CONSTRAINT `snippet_groups_created_by_fkey`
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: snippets → snippet_groups (SET NULL on group delete)
ALTER TABLE `snippets`
  ADD CONSTRAINT `snippets_group_id_fkey`
  FOREIGN KEY (`group_id`) REFERENCES `snippet_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
