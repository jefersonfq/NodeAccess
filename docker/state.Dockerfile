# Security revisions of the upstream images are fixed; installed OS updates are
# inventoried again in the release image scan.
FROM container-registry.oracle.com/mysql/community-server:8.4.12@sha256:7dcc4add9183664de3a214daf85a50c3ba6cccfd7534f700b6561bf5b41885be AS mysql
USER root
# mysql-shell is an administrative tool with a bundled Python environment, not
# required by mysqld/mysqldump or the application.
RUN microdnf remove -y mysql-shell && microdnf update -y && microdnf clean all \
    && groupmod -g 999 mysql && usermod -u 999 -g 999 mysql \
    && chown -R 999:999 /var/lib/mysql /var/lib/mysql-files /var/run/mysqld
# Preserve the UID/GID used by the previous Docker Official MySQL image.
USER 999:999

FROM redis:8.2.10-alpine@sha256:b51665e66f00759be7c3152ad5ac3c66fb2f619c13ef62dea7cc1f9914524635 AS redis
RUN sed -i 's/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g' /etc/apk/repositories \
    && apk upgrade --no-cache
