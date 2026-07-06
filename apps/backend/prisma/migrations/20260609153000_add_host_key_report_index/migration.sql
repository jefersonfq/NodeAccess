CREATE INDEX `admin_logs_target_type_action_timestamp_idx`
  ON `admin_logs`(`target_type`, `action`, `timestamp`);
