ALTER TABLE `agents`
  ADD COLUMN `agent_type` ENUM('PROXY_AGENT', 'PRIVATE_ACCESS_CONNECTOR') NOT NULL DEFAULT 'PROXY_AGENT' AFTER `token_hash`,
  ADD COLUMN `site_name` VARCHAR(120) NULL AFTER `is_default`,
  ADD COLUMN `environment` VARCHAR(80) NULL AFTER `site_name`,
  ADD COLUMN `private_access_allowed_cidrs_json` JSON NULL AFTER `environment`,
  ADD COLUMN `private_access_allowed_hostnames_json` JSON NULL AFTER `private_access_allowed_cidrs_json`,
  ADD COLUMN `private_access_allowed_ports_json` JSON NULL AFTER `private_access_allowed_hostnames_json`,
  ADD COLUMN `private_access_allowed_host_tags_json` JSON NULL AFTER `private_access_allowed_ports_json`,
  ADD COLUMN `private_access_allow_fallback` BOOLEAN NOT NULL DEFAULT FALSE AFTER `private_access_allowed_host_tags_json`;

CREATE INDEX `agents_private_access_lookup_idx`
  ON `agents`(`tenant_id`, `deleted_at`, `active`, `agent_type`, `agent_mode`, `is_default`);
