CREATE TABLE `ai_ssh_action_runs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `host_id` INTEGER NOT NULL,
  `requested_by_id` INTEGER NOT NULL,
  `approved_by_id` INTEGER NULL,
  `channel` VARCHAR(30) NOT NULL,
  `mode` ENUM('READ_ONLY', 'DIAGNOSTIC_ONLY', 'APPROVAL_REQUIRED', 'FULL_OPERATIONAL_ACCESS') NOT NULL,
  `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  `summary` VARCHAR(500) NOT NULL,
  `plan_json` LONGTEXT NULL,
  `approval_reason` TEXT NULL,
  `error_message` TEXT NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ai_ssh_action_runs_tenant_id_host_id_created_at_idx`(`tenant_id`, `host_id`, `created_at`),
  INDEX `ai_ssh_action_runs_tenant_id_requested_by_id_created_at_idx`(`tenant_id`, `requested_by_id`, `created_at`),
  INDEX `ai_ssh_action_runs_status_created_at_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_ssh_action_run_steps` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `run_id` INTEGER NOT NULL,
  `step_id` VARCHAR(80) NOT NULL,
  `label` VARCHAR(160) NOT NULL,
  `command` TEXT NOT NULL,
  `status` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
  `exit_code` INTEGER NULL,
  `output_preview` TEXT NULL,
  `redaction_applied` BOOLEAN NOT NULL DEFAULT false,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ai_ssh_action_run_steps_run_id_created_at_idx`(`run_id`, `created_at`),
  INDEX `ai_ssh_action_run_steps_status_created_at_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
