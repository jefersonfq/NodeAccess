# Fetch with bounded retries while retaining TLS verification and the reviewed checksum.
FROM container-registry.oracle.com/mysql/community-server:8.4.12@sha256:7dcc4add9183664de3a214daf85a50c3ba6cccfd7534f700b6561bf5b41885be AS mysql-security-packages
RUN curl --http1.1 --fail --show-error --silent --ipv4 --retry 2 --retry-all-errors \
    --retry-delay 2 --retry-max-time 180 --connect-timeout 20 --max-time 90 \
    --output /tmp/nodeaccess-libbrotli.rpm https://yum.oracle.com/repo/OracleLinux/OL9/baseos/latest/x86_64/getPackage/libbrotli-1.0.9-10.0.1.el9_8.x86_64.rpm \
    && echo "8c2f4ac5d65281f0be6468a1098e0bae6fc24098de88fa5177b08912aec282df  /tmp/nodeaccess-libbrotli.rpm" | sha256sum -c -

# Security revisions of the upstream images are fixed; installed OS updates are
# inventoried again in the release image scan.
FROM container-registry.oracle.com/mysql/community-server:8.4.12@sha256:7dcc4add9183664de3a214daf85a50c3ba6cccfd7534f700b6561bf5b41885be AS mysql
USER root
# mysql-shell is an administrative tool with a bundled Python environment, not
# required by mysqld/mysqldump or the application.
RUN microdnf remove -y mysql-shell && microdnf update -y && microdnf clean all \
    && groupmod -g 999 mysql && usermod -u 999 -g 999 mysql \
    && chown -R 999:999 /var/lib/mysql /var/lib/mysql-files /var/run/mysqld
# ELSA-2026-90495 fixes CVE-2026-111497; retain the mandatory OS update above.
# This reviewed RPM is x86_64. Repin if upstream installs a newer version; never downgrade.
COPY --from=mysql-security-packages /tmp/nodeaccess-libbrotli.rpm /tmp/nodeaccess-libbrotli.rpm
RUN rpm --checksig /tmp/nodeaccess-libbrotli.rpm \
    && rpm -Uvh --replacepkgs /tmp/nodeaccess-libbrotli.rpm \
    && rm /tmp/nodeaccess-libbrotli.rpm
# Preserve the UID/GID used by the previous Docker Official MySQL image.
USER 999:999

FROM redis:8.2.10-alpine@sha256:b51665e66f00759be7c3152ad5ac3c66fb2f619c13ef62dea7cc1f9914524635 AS redis
RUN sed -i 's/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g' /etc/apk/repositories \
    && apk upgrade --no-cache
