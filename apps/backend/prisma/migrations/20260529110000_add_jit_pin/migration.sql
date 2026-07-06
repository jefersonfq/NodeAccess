ALTER TABLE `host_links`
  ADD COLUMN `pin_hash` VARCHAR(64) NULL;

ALTER TABLE `licenses`
  ADD COLUMN `jit_access_pin_required` BOOLEAN NOT NULL DEFAULT false;
