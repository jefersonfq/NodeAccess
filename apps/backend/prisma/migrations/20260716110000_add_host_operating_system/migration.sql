ALTER TABLE `hosts`
  ADD COLUMN `operating_system` ENUM(
    'UNKNOWN',
    'LINUX',
    'UBUNTU',
    'DEBIAN',
    'CENTOS',
    'RHEL',
    'ROCKY',
    'ALMALINUX',
    'SUSE',
    'WINDOWS',
    'WINDOWS_SERVER',
    'MACOS',
    'FREEBSD',
    'OTHER'
  ) NOT NULL DEFAULT 'UNKNOWN' AFTER `access_protocol`;

