CREATE TABLE `local_ai_knowledge_documents` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `created_by_user_id` INTEGER NOT NULL,
  `source_type` ENUM('TEXT', 'LINK', 'FILE') NOT NULL,
  `status` ENUM('READY', 'FAILED') NOT NULL DEFAULT 'READY',
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `reference_url` TEXT NULL,
  `file_name` VARCHAR(191) NULL,
  `mime_type` VARCHAR(191) NULL,
  `byte_size` INTEGER NULL,
  `content_text` LONGTEXT NULL,
  `error_message` TEXT NULL,
  `deleted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `idx_lai_kb_tenant_status_created`(`tenant_id`, `status`, `created_at`),
  INDEX `idx_lai_kb_tenant_source_created`(`tenant_id`, `source_type`, `created_at`),
  INDEX `idx_lai_kb_user_created`(`created_by_user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `local_ai_knowledge_documents`
  ADD CONSTRAINT `fk_lai_kb_doc_tenant`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `local_ai_knowledge_documents`
  ADD CONSTRAINT `fk_lai_kb_doc_user`
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
