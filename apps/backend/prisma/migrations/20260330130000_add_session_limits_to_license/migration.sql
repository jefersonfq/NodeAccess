ALTER TABLE `licenses`
  ADD COLUMN `max_active_sessions_per_user` INTEGER NULL,
  ADD COLUMN `max_active_sessions_tenant` INTEGER NULL;
