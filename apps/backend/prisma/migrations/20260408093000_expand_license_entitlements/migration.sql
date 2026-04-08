ALTER TABLE `licenses`
  ADD COLUMN `max_hosts` INT NULL,
  ADD COLUMN `feature_entitlements_json` JSON NULL,
  ADD COLUMN `integration_entitlements_json` JSON NULL;
