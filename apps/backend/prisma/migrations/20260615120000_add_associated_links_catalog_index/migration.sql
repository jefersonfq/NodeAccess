CREATE INDEX `host_assoc_links_tenant_enabled_host_pos_idx`
  ON `host_associated_links`(`tenant_id`, `enabled`, `host_id`, `position`);
