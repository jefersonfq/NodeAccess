-- Additive domain: never reuse SSH secrets as website credentials.
-- Disabling the site feature preserves these rows; rollback must not drop user data.
CREATE TABLE vault_site_items (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 tenant_id INT NOT NULL,
 kind VARCHAR(8) NOT NULL,
 label VARCHAR(160) NOT NULL,
 scope VARCHAR(8) NOT NULL,
 owner_user_id INT NULL,
 group_id INT NULL,
 created_by_user_id INT NOT NULL,
 username VARCHAR(320) NULL,
 origins JSON NOT NULL,
 url VARCHAR(2048) NULL,
 host_id INT NULL,
 allow_fill BOOLEAN NOT NULL DEFAULT FALSE,
 encrypted_value MEDIUMTEXT NULL,
 iv VARCHAR(32) NULL,
 version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 revoked_at DATETIME(3) NULL,
 deleted_at DATETIME(3) NULL,
 INDEX vault_sites_catalog(tenant_id,deleted_at,revoked_at,id),
 INDEX vault_sites_group(tenant_id,group_id),
 CONSTRAINT vault_sites_tenant FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
 CONSTRAINT vault_sites_owner FOREIGN KEY(owner_user_id) REFERENCES users(id),
 CONSTRAINT vault_sites_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id),
 CONSTRAINT vault_sites_group_fk FOREIGN KEY(group_id) REFERENCES `groups`(id),
 CONSTRAINT vault_sites_host FOREIGN KEY(host_id) REFERENCES hosts(id) ON DELETE SET NULL,
 CONSTRAINT vault_sites_scope CHECK(
   (scope='PERSONAL' AND owner_user_id IS NOT NULL AND group_id IS NULL) OR
   (scope='GROUP' AND owner_user_id IS NULL AND group_id IS NOT NULL) OR
   (scope='TENANT' AND owner_user_id IS NULL AND group_id IS NULL)),
 CONSTRAINT vault_sites_kind CHECK(
   (kind='login' AND username IS NOT NULL AND url IS NULL AND
     ((encrypted_value IS NOT NULL AND iv IS NOT NULL) OR revoked_at IS NOT NULL OR deleted_at IS NOT NULL)) OR
   (kind='url' AND url IS NOT NULL AND username IS NULL AND encrypted_value IS NULL AND iv IS NULL AND allow_fill=FALSE)),
 CONSTRAINT vault_sites_version CHECK(version > 0)
);
