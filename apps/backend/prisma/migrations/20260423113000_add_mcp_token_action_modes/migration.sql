ALTER TABLE mcp_tokens
  ADD COLUMN allowed_action_modes_json JSON NULL AFTER allowed_capabilities_json;
