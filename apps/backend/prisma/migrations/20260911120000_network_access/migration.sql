ALTER TABLE hosts ADD COLUMN device_profile VARCHAR(40) NULL;
CREATE TABLE network_settings (
 tenant_id INT NOT NULL PRIMARY KEY,
 default_profile VARCHAR(40) NOT NULL DEFAULT 'server_ssh',
 tacacs_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE TABLE network_tacacs_devices (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 tenant_id INT NOT NULL,
 host_id INT NOT NULL,
 source_ip VARCHAR(45) NOT NULL UNIQUE,
 secret_cipher TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY (tenant_id) REFERENCES tenants(id),
 FOREIGN KEY (host_id) REFERENCES hosts(id),
 UNIQUE KEY network_device_host (tenant_id, host_id)
);
CREATE TABLE network_tacacs_credentials (
 tenant_id INT NOT NULL,
 user_id INT NOT NULL,
 username VARCHAR(64) NOT NULL,
 password_hash VARCHAR(255) NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY (tenant_id,user_id),
 UNIQUE KEY network_aaa_username (tenant_id,username),
 FOREIGN KEY (tenant_id) REFERENCES tenants(id),
 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE network_tacacs_grants (
 tenant_id INT NOT NULL,
 user_id INT NOT NULL,
 host_id INT NOT NULL,
 commands_json TEXT NOT NULL,
 PRIMARY KEY (tenant_id,user_id,host_id),
 FOREIGN KEY (tenant_id) REFERENCES tenants(id),
 FOREIGN KEY (user_id) REFERENCES users(id),
 FOREIGN KEY (host_id) REFERENCES hosts(id)
);
CREATE TABLE network_tacacs_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 tenant_id INT NOT NULL,
 device_id INT NOT NULL,
 username VARCHAR(64) NOT NULL,
 kind VARCHAR(20) NOT NULL,
 outcome VARCHAR(20) NOT NULL,
 command_json TEXT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX network_events_tenant_time (tenant_id,created_at)
);
