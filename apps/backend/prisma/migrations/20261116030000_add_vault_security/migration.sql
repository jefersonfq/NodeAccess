-- Additive, opt-in vault extraction. No existing secret becomes web eligible.
CREATE TABLE vault_policies (
 tenant_id INT NOT NULL PRIMARY KEY, version INT NOT NULL DEFAULT 1,
 config JSON NOT NULL,
 CONSTRAINT vault_policy_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE TABLE vault_entitlements (
 tenant_id INT NOT NULL, user_id INT NOT NULL, action VARCHAR(16) NOT NULL,
 granted_by INT NOT NULL, approved_by INT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(tenant_id,user_id,action),
 CONSTRAINT vault_grant_separation CHECK(granted_by <> approved_by AND granted_by <> user_id AND approved_by <> user_id),
 CONSTRAINT vault_grant_action CHECK(action IN ('reveal','copy')),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(granted_by) REFERENCES users(id), FOREIGN KEY(approved_by) REFERENCES users(id)
);
CREATE TABLE vault_web_items (
 tenant_id INT NOT NULL, secret_id INT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(tenant_id,secret_id),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 FOREIGN KEY(secret_id) REFERENCES secrets(id) ON DELETE CASCADE
);
CREATE TABLE vault_records (
 tenant_id INT NOT NULL, user_id INT NOT NULL, kind VARCHAR(16) NOT NULL, token_hash CHAR(64) NOT NULL,
 payload JSON NOT NULL, expires_at DATETIME(3) NOT NULL,
 PRIMARY KEY(tenant_id,user_id,kind,token_hash), INDEX vault_record_expiry(expires_at),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE vault_limits (
 tenant_id INT NOT NULL, bucket_hash CHAR(64) NOT NULL, window_start BIGINT NOT NULL, count INT NOT NULL,
 PRIMARY KEY(tenant_id,bucket_hash), FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE TABLE vault_audit (
 event_id CHAR(36) NOT NULL PRIMARY KEY, tenant_id INT NOT NULL, user_id INT NOT NULL,
 event_type VARCHAR(40) NOT NULL, metadata JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX vault_audit_tenant(tenant_id,created_at)
);

CREATE TABLE vault_managers (
 tenant_id INT NOT NULL, user_id INT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(tenant_id,user_id), FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE vault_proposals (
 tenant_id INT NOT NULL, proposal_hash CHAR(64) NOT NULL, proposed_by INT NOT NULL,
 payload JSON NOT NULL, expires_at DATETIME(3) NOT NULL,
 PRIMARY KEY(tenant_id,proposal_hash), INDEX vault_proposal_expiry(expires_at),
 FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 FOREIGN KEY(proposed_by) REFERENCES users(id) ON DELETE CASCADE
);
