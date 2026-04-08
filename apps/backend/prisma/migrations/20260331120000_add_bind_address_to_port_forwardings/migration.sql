ALTER TABLE `port_forwardings`
  ADD COLUMN `bind_address` VARCHAR(45) NOT NULL DEFAULT '127.0.0.1' AFTER `description`;
