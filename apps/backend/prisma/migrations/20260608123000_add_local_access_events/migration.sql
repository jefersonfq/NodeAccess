CREATE TABLE `local_access_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `forwarding_id` INTEGER NULL,
  `host_id` INTEGER NULL,
  `event_type` ENUM('WEB', 'TUNNEL') NOT NULL,
  `label_snapshot` VARCHAR(255) NULL,
  `host_name_snapshot` VARCHAR(255) NULL,
  `remote_host_snapshot` VARCHAR(255) NOT NULL,
  `remote_port_snapshot` INTEGER NOT NULL,
  `local_port_snapshot` INTEGER NULL,
  `used_port_fallback` BOOLEAN NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `metadata_json` JSON NULL,

  PRIMARY KEY (`id`),
  INDEX `local_access_events_tenant_occurred_idx` (`tenant_id`, `occurred_at`),
  INDEX `local_access_events_tenant_user_occurred_idx` (`tenant_id`, `user_id`, `occurred_at`),
  INDEX `local_access_events_tenant_forwarding_occurred_idx` (`tenant_id`, `forwarding_id`, `occurred_at`),
  INDEX `local_access_events_tenant_host_occurred_idx` (`tenant_id`, `host_id`, `occurred_at`),
  INDEX `local_access_events_tenant_type_occurred_idx` (`tenant_id`, `event_type`, `occurred_at`),
  CONSTRAINT `local_access_events_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `local_access_events_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `local_access_events_forwarding_id_fkey`
    FOREIGN KEY (`forwarding_id`) REFERENCES `port_forwardings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `local_access_events_host_id_fkey`
    FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `local_access_events` (
  `tenant_id`,
  `user_id`,
  `forwarding_id`,
  `host_id`,
  `event_type`,
  `label_snapshot`,
  `host_name_snapshot`,
  `remote_host_snapshot`,
  `remote_port_snapshot`,
  `local_port_snapshot`,
  `occurred_at`,
  `metadata_json`
)
SELECT
  u.`tenant_id`,
  l.`admin_id`,
  pf.`id`,
  pf.`host_id`,
  CASE WHEN l.`action` = 'USER_WEB_ACCESS_OPENED' THEN 'WEB' ELSE 'TUNNEL' END,
  pf.`description`,
  h.`name`,
  pf.`remote_host`,
  pf.`remote_port`,
  pf.`local_port`,
  l.`timestamp`,
  JSON_OBJECT('source', 'admin_logs_backfill', 'adminLogId', l.`id`)
FROM `admin_logs` l
INNER JOIN `users` u ON u.`id` = l.`admin_id`
INNER JOIN `port_forwardings` pf ON pf.`id` = l.`target_id`
INNER JOIN `hosts` h ON h.`id` = pf.`host_id`
WHERE l.`target_type` = 'PortForwarding'
  AND l.`action` IN ('USER_WEB_ACCESS_OPENED', 'USER_TUNNEL_OPENED')
  AND NOT (
    l.`action` = 'USER_TUNNEL_OPENED'
    AND COALESCE(l.`details`, '') LIKE '%"description":"Web access:%'
  );
