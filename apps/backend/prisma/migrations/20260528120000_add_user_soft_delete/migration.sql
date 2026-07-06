-- AlterTable: add deleted_at column
ALTER TABLE `users` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- AlterTable: remove global unique on email (uniqueness enforced at app layer for non-deleted users)
ALTER TABLE `users` DROP INDEX `users_email_key`;

-- CreateIndex: email+tenantId lookup
CREATE INDEX `users_email_tenant_id_idx` ON `users`(`email`, `tenant_id`);

-- CreateIndex: filter deleted users efficiently
CREATE INDEX `users_tenant_id_deleted_at_idx` ON `users`(`tenant_id`, `deleted_at`);
