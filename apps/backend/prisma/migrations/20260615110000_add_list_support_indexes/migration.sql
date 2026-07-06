CREATE INDEX `groups_tenant_name_idx` ON `groups`(`tenant_id`, `name`);

CREATE INDEX `user_groups_group_user_idx` ON `user_groups`(`group_id`, `user_id`);

CREATE INDEX `folders_tenant_user_name_idx` ON `folders`(`tenant_id`, `user_id`, `name`);

CREATE INDEX `bastions_tenant_name_idx` ON `bastion_hosts`(`tenant_id`, `name`);
