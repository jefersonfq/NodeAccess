ALTER TABLE `feedbacks`
  ADD COLUMN `deleted_at` DATETIME(3) NULL,
  ADD COLUMN `deleted_by_user_id` INTEGER NULL;

CREATE INDEX `feedbacks_deleted_by_user_id_idx` ON `feedbacks`(`deleted_by_user_id`);

ALTER TABLE `feedbacks`
  ADD CONSTRAINT `feedbacks_deleted_by_user_id_fkey`
    FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
