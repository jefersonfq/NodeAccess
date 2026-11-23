-- NA-0193: trusted extension devices (renewal without the portal consent page for 7 days).
-- Additive: one 'trust' row per device in vault_extension_tokens (token_hash = SHA-256 of 'trust:<jkt>').
-- Rollback: DELETE FROM vault_extension_tokens WHERE kind='trust'; restore the CHECK to ('code','access').
ALTER TABLE vault_extension_tokens DROP CHECK vault_extension_token_kind;
ALTER TABLE vault_extension_tokens ADD CONSTRAINT vault_extension_token_kind CHECK(kind IN ('code','access','trust'));
