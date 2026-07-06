CREATE INDEX `hosts_tenant_deleted_name_idx`
  ON `hosts`(`tenant_id`, `deleted_at`, `name`);

CREATE INDEX `idx_host_assoc_links_tenant_host_pos`
  ON `host_associated_links`(`tenant_id`, `host_id`, `position`);

CREATE INDEX `pem_keys_created_by_created_at_idx`
  ON `pem_keys`(`created_by`, `created_at`);

CREATE INDEX `agents_user_status_lookup_idx`
  ON `agents`(`tenant_id`, `deleted_at`, `active`, `created_by`, `is_default`, `last_seen_at`);

CREATE INDEX `agents_tenant_status_lookup_idx`
  ON `agents`(`tenant_id`, `deleted_at`, `active`, `agent_mode`, `is_default`, `last_seen_at`);

CREATE INDEX `port_forwardings_host_created_at_idx`
  ON `port_forwardings`(`host_id`, `created_at`);
