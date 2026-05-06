ALTER TABLE mcp_tokens
  ADD COLUMN allowed_host_ids_json JSON NULL AFTER allowed_action_modes_json;
