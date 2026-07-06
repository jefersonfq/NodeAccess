ALTER TABLE `sessions`
  ADD COLUMN `access_type` VARCHAR(32) NOT NULL DEFAULT 'authenticated',
  ADD COLUMN `jit_link_id` INT NULL,
  ADD COLUMN `jit_guest_name` VARCHAR(80) NULL;

CREATE INDEX `sessions_access_type_started_at_idx` ON `sessions`(`access_type`, `started_at`);
CREATE INDEX `sessions_jit_link_id_active_idx` ON `sessions`(`jit_link_id`, `active`);

ALTER TABLE `sessions`
  ADD CONSTRAINT `sessions_jit_link_id_fkey`
  FOREIGN KEY (`jit_link_id`) REFERENCES `host_links`(`id`)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
