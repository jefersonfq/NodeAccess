-- Optional contact for the requested trial; existing registrations remain NULL.
ALTER TABLE `trial_registrations` ADD COLUMN `phone_encrypted` TEXT NULL;
