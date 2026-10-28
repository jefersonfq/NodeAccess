-- Optional evidence snapshot; existing consent events remain unchanged.
ALTER TABLE `trial_consent_events` ADD COLUMN `metadata_json` JSON NULL;
