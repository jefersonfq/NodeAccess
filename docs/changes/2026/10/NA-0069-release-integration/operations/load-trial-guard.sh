#!/usr/bin/env bash
set -euo pipefail
umask 077
# One atomic transaction replaces this table only; leave it present on stop.
exec 9>/run/lock/nodeaccess-trial-guard.lock
/usr/bin/flock -x 9
batch=$(mktemp /run/nodeaccess-trial-guard.XXXXXX)
tables=$(mktemp /run/nodeaccess-trial-tables.XXXXXX)
trap 'rm -f "$batch" "$tables"' EXIT
/usr/sbin/nft list tables > "$tables"
if grep -Fxq 'table inet nodeaccess_trial_guard' "$tables"; then
    /usr/sbin/nft list table inet nodeaccess_trial_guard > "$tables"
    if ! grep -Fq 'comment "NodeAccess NA0069 trial guard v1"' "$tables"; then
        echo 'Refusing replacement of an unrecognized trial guard table' >&2
        exit 1
    fi
    printf '%s\n' 'delete table inet nodeaccess_trial_guard' > "$batch"
fi
cat /etc/nodeaccess-trial/trial-guard.nft >> "$batch"
/usr/sbin/nft --check --file "$batch"
/usr/sbin/nft --file "$batch"
/usr/sbin/nft list table inet nodeaccess_trial_guard >/dev/null
