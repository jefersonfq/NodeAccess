ALTER TABLE `port_forwardings`
  ADD COLUMN `web_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `web_protocol` VARCHAR(8) NOT NULL DEFAULT 'http';
