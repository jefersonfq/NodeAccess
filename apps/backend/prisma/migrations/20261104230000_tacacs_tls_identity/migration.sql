-- Add identity without enabling or converting any legacy registration.
-- NULL fingerprints fail closed until an administrator registers a TLS certificate.
-- Keep the old column for migration history; the TLS service never reads it.
ALTER TABLE network_tacacs_devices
  MODIFY COLUMN secret_cipher TEXT NULL,
  ADD COLUMN certificate_fingerprint_sha256 CHAR(64) NULL,
  ADD UNIQUE KEY network_device_certificate (certificate_fingerprint_sha256);
