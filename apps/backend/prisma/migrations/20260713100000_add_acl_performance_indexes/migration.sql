CREATE INDEX `inventory_nodes_tenant_deleted_type_path_idx`
  ON `inventory_nodes`(`tenant_id`, `deleted_at`, `type`, `path`(512));

CREATE INDEX `sessions_user_active_access_host_idx`
  ON `sessions`(`user_id`, `active`, `access_type`, `host_id`);

CREATE INDEX `sessions_host_active_access_idx`
  ON `sessions`(`host_id`, `active`, `access_type`);
