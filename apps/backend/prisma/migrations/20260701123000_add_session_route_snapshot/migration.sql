ALTER TABLE `sessions`
  ADD COLUMN `route_snapshot_json` JSON NULL AFTER `agent_source`;

ALTER TABLE `session_audits`
  ADD COLUMN `route_snapshot_json` JSON NULL AFTER `connection_method`;
