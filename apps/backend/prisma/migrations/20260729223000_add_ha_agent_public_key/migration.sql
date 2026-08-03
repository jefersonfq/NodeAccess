ALTER TABLE `ha_nodes`
  ADD COLUMN `agent_public_key` TEXT NULL AFTER `inventory_json`;
