-- NA-0183: additive browser-extension access. Absent grant = denied; feature flag VAULT_EXTENSION_ENABLED defaults off.
-- Rollback: DELETE FROM vault_entitlements WHERE action='extension'; drop both tables; restore the CHECK to ('reveal','copy').
ALTER TABLE vault_entitlements DROP CHECK vault_grant_action;
ALTER TABLE vault_entitlements ADD CONSTRAINT vault_grant_action CHECK(action IN ('reveal','copy','extension'));
CREATE TABLE vault_extension_devices (
 tenant_id INT NOT NULL, user_id INT NOT NULL, jkt CHAR(43) NOT NULL, extension_id CHAR(32) NOT NULL,
 state VARCHAR(8) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 last_used_at DATETIME(3) NULL, revoked_at DATETIME(3) NULL,
 PRIMARY KEY(tenant_id,user_id,jkt),
 CONSTRAINT vault_extension_device_state CHECK(state IN ('ACTIVE','REVOKED')),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- Opaque one-time codes and access authorizations; only SHA-256 of the token is stored.
CREATE TABLE vault_extension_tokens (
 token_hash CHAR(64) NOT NULL PRIMARY KEY, kind VARCHAR(8) NOT NULL, tenant_id INT NOT NULL, user_id INT NOT NULL,
 jkt CHAR(43) NOT NULL, payload JSON NOT NULL, expires_at DATETIME(3) NOT NULL,
 INDEX vault_extension_token_expiry(expires_at), INDEX vault_extension_token_owner(tenant_id,user_id),
 CONSTRAINT vault_extension_token_kind CHECK(kind IN ('code','access')),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
