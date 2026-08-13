-- Preserve access for tenants that already configured OIDC before the
-- provider-specific entitlement was introduced.
UPDATE `licenses` AS license
SET
  license.`feature_entitlements_json` = JSON_SET(
    COALESCE(license.`feature_entitlements_json`, JSON_OBJECT()),
    '$.integrations',
    CAST('true' AS JSON)
  ),
  license.`integration_entitlements_json` = JSON_SET(
    COALESCE(license.`integration_entitlements_json`, JSON_OBJECT()),
    '$.oidc',
    CAST('true' AS JSON)
  )
WHERE EXISTS (
  SELECT 1
  FROM `integrations` AS integration_record
  WHERE integration_record.`tenant_id` = license.`tenant_id`
    AND integration_record.`provider` = 'oidc'
);
