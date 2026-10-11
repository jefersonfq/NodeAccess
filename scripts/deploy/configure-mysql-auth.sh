#!/bin/sh
# Executed inside the MySQL container by installation/update/rollback.
set -eu
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"
: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
to_hex() { printf '%s' "$1" | od -An -tx1 | tr -d ' \n'; }
db_user_hex="$(to_hex "$MYSQL_USER")"
db_password_hex="$(to_hex "$MYSQL_PASSWORD")"
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
mysql --protocol=socket -uroot <<SQL
SET @db_user = CONVERT(0x${db_user_hex} USING utf8mb4);
SET @db_password = CONVERT(0x${db_password_hex} USING utf8mb4);
SET @sql = CONCAT('ALTER USER ', QUOTE(@db_user), '@', QUOTE('%'), ' IDENTIFIED WITH caching_sha2_password BY ', QUOTE(@db_password));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SQL
