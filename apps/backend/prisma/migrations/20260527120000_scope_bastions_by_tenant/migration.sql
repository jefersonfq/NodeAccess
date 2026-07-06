ALTER TABLE `bastion_hosts`
  ADD COLUMN `tenant_id` INTEGER NULL;

UPDATE `bastion_hosts` bh
LEFT JOIN (
  SELECT `bastion_id`, MIN(`tenant_id`) AS `tenant_id`
  FROM (
    SELECT `bastion_id`, `tenant_id`
    FROM `hosts`
    WHERE `bastion_id` IS NOT NULL
    UNION ALL
    SELECT `bastion_id`, `tenant_id`
    FROM `groups`
    WHERE `bastion_id` IS NOT NULL
  ) linked_bastions
  GROUP BY `bastion_id`
) usage_tenants ON usage_tenants.`bastion_id` = bh.`id`
SET bh.`tenant_id` = COALESCE(
  usage_tenants.`tenant_id`,
  (SELECT `id` FROM `tenants` ORDER BY `id` ASC LIMIT 1)
);

ALTER TABLE `bastion_hosts`
  MODIFY COLUMN `tenant_id` INTEGER NOT NULL;

ALTER TABLE `bastion_hosts`
  ADD INDEX `bastion_hosts_tenant_id_idx` (`tenant_id`);

ALTER TABLE `bastion_hosts`
  ADD CONSTRAINT `bastion_hosts_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
