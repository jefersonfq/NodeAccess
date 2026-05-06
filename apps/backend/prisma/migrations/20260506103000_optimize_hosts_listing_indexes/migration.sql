CREATE INDEX `hosts_tenant_deleted_scope_name_idx`
  ON `hosts`(`tenant_id`, `deleted_at`, `scope`, `name`);

CREATE INDEX `hosts_tenant_deleted_group_name_idx`
  ON `hosts`(`tenant_id`, `deleted_at`, `group_id`, `name`);

CREATE INDEX `hosts_tenant_deleted_folder_name_idx`
  ON `hosts`(`tenant_id`, `deleted_at`, `folder_id`, `name`);

CREATE INDEX `hosts_tenant_deleted_owner_name_idx`
  ON `hosts`(`tenant_id`, `deleted_at`, `owner_id`, `name`);

CREATE INDEX `host_tags_tag_host_idx`
  ON `host_tags`(`tag_id`, `host_id`);
