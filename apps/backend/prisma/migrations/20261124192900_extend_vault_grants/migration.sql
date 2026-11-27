-- New grants start absent (denied). Existing portal writers retain their resource ACL.
ALTER TABLE vault_entitlements DROP CHECK vault_grant_action;
ALTER TABLE vault_entitlements ADD CONSTRAINT vault_grant_action
  CHECK(action IN ('reveal','copy','extension','shared-write','fill'));
