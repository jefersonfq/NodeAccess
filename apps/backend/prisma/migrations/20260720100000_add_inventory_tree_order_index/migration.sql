CREATE INDEX `inventory_nodes_tenant_deleted_depth_name_idx`
  ON `inventory_nodes`(`tenant_id`, `deleted_at`, `depth`, `name`, `id`);
