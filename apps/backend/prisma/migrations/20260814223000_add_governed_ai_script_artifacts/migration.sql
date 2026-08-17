CREATE TABLE `ai_script_artifacts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `host_id` INTEGER NOT NULL,
  `created_by_id` INTEGER NOT NULL,
  `action_run_id` INTEGER NULL,
  `title` VARCHAR(160) NOT NULL,
  `objective` VARCHAR(500) NOT NULL,
  `destination` VARCHAR(255) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `checksum` CHAR(64) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `risk` VARCHAR(24) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_script_artifacts_tenant_id_host_id_created_at_idx` (`tenant_id`, `host_id`, `created_at`),
  INDEX `ai_script_artifacts_action_run_id_idx` (`action_run_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_ssh_action_runs` ADD COLUMN `script_artifact_id` INTEGER NULL;
CREATE INDEX `ai_ssh_action_runs_script_artifact_id_idx` ON `ai_ssh_action_runs` (`script_artifact_id`);
