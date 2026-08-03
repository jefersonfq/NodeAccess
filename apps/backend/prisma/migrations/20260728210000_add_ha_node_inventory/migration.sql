ALTER TABLE `ha_nodes`
  ADD COLUMN `inventory_json` JSON NULL AFTER `components_json`;
