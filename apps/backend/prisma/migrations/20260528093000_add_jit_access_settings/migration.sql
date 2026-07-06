ALTER TABLE `licenses`
  ADD COLUMN `jit_access_expiry_minutes_json` JSON NULL,
  ADD COLUMN `jit_access_max_expiry_minutes` INT NULL;
