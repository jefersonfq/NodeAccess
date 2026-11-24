-- NA-0198: Windows Hello / passkey (WebAuthn) credentials to unlock the vault in the portal.
-- Additive: new table only; older versions never read it. Rollback: DROP TABLE vault_webauthn_credentials.
-- credential_hash = SHA-256 of the base64url credential id (ids may exceed an index key); the id itself is kept for allowCredentials.
CREATE TABLE vault_webauthn_credentials (
 credential_hash CHAR(64) NOT NULL PRIMARY KEY,
 tenant_id INT NOT NULL, user_id INT NOT NULL,
 credential_id VARCHAR(1400) CHARACTER SET ascii NOT NULL,
 public_key VARBINARY(2048) NOT NULL,
 sign_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
 transports VARCHAR(128) CHARACTER SET ascii NOT NULL DEFAULT '',
 name VARCHAR(80) NOT NULL,
 -- Credential version of the account at registration: a password or MFA reset makes older passkeys unusable.
 credential_version CHAR(64) CHARACTER SET ascii NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 last_used_at DATETIME(3) NULL,
 INDEX vault_webauthn_owner(tenant_id,user_id),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
