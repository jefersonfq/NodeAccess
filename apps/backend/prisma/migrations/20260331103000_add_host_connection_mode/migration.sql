ALTER TABLE `hosts`
  ADD COLUMN `connection_mode` ENUM('DIRECT', 'AGENT') NOT NULL DEFAULT 'DIRECT' AFTER `auth_type`;
