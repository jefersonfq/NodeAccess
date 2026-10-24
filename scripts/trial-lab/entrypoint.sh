#!/bin/sh
set -eu
for source in /opt/lab-etc/* /opt/lab-etc/.[!.]*; do
  [ -e "$source" ] || [ -L "$source" ] || continue
  case "${source##*/}" in hosts|hostname|resolv.conf) continue ;; esac
  cp -R "$source" /etc/
done
mkdir -p /run/sshd /home/demo
while [ ! -f /run/lab-ready ]; do sleep 0.1; done
exec /usr/sbin/sshd -D -e -f /run/sshd_config
