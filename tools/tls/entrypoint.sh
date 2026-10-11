#!/bin/sh
set -eu
umask 077
mkdir -p /var/lib/nodeaccess-tls
# The lock survives exec and is released by the kernel even after a crash.
if [ -f /var/lib/nodeaccess-tls/worker.lock ]; then
  exec 9</var/lib/nodeaccess-tls/worker.lock
else
  exec 9>/var/lib/nodeaccess-tls/worker.lock
fi
if ! flock -n 9; then
  echo 'Another TLS worker owns this state directory.' >&2
  exit 1
fi
exec node /opt/nodeaccess-tls/server.mjs
