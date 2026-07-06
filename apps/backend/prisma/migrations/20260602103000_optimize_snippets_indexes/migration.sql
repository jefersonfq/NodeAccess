CREATE INDEX `snippets_tenant_scope_name_idx`
  ON `snippets`(`tenant_id`, `scope`, `name`);

CREATE INDEX `snippets_tenant_scope_creator_name_idx`
  ON `snippets`(`tenant_id`, `scope`, `created_by`, `name`);

CREATE INDEX `snippets_tenant_group_scope_name_idx`
  ON `snippets`(`tenant_id`, `group_id`, `scope`, `name`);

CREATE INDEX `snippet_groups_tenant_scope_name_idx`
  ON `snippet_groups`(`tenant_id`, `scope`, `name`);

CREATE INDEX `snippet_groups_tenant_scope_creator_name_idx`
  ON `snippet_groups`(`tenant_id`, `scope`, `created_by`, `name`);
