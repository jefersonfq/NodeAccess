ALTER TABLE `hosts`
  ADD COLUMN `startup_snippet_id` INTEGER NULL,
  ADD COLUMN `startup_snippet_mode` VARCHAR(16) NOT NULL DEFAULT 'DISABLED';

CREATE INDEX `hosts_startup_snippet_id_idx`
  ON `hosts`(`startup_snippet_id`);

ALTER TABLE `hosts`
  ADD CONSTRAINT `hosts_startup_snippet_id_fkey`
  FOREIGN KEY (`startup_snippet_id`) REFERENCES `snippets`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
