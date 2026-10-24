# Guacamole 1.6.0 with the reviewed Apache FreeRDP compatibility backport.
# Provenance and maintenance requirements: docker/guacd/README.md
ARG BASE=alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
FROM ${BASE} AS build
RUN sed -i s/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g /etc/apk/repositories && apk add --no-cache \
    build-base autoconf automake libtool pkgconf cairo-dev cunit-dev freerdp-dev=3.32.1-r0 \
    libjpeg-turbo-dev libpng-dev libwebp-dev libvncserver-dev=0.9.15-r0 openssl-dev=3.5.9-r0 \
    pango-dev libssh2-dev libwebsockets-dev pulseaudio-dev util-linux-dev
ADD --checksum=sha256:8bc45675da96d7b6f39728160181e3d4ff3c08f460f6d26de5805b642bf13f2b https://downloads.apache.org/guacamole/1.6.0/source/guacamole-server-1.6.0.tar.gz /tmp/guacamole-server.tar.gz
RUN mkdir /src && tar -xzf /tmp/guacamole-server.tar.gz --strip-components=1 -C /src && rm /tmp/guacamole-server.tar.gz
COPY docker/guacd/guacamole-2328.patch /tmp/guacamole-2328.patch
RUN echo "b47b3c026839a4e002e39515017e40d75631e1880abbe7688e0d4d3ffec48e46  /tmp/guacamole-2328.patch" | sha256sum -c - && patch -d /src -p1 --fuzz=0 < /tmp/guacamole-2328.patch
WORKDIR /src
RUN CPPFLAGS=-Wno-error=deprecated-declarations ./configure --prefix=/opt/guacamole --disable-guaclog --with-freerdp-plugin-dir=/usr/lib/freerdp3 && \
    make -j4 && make install && \
    src/guacd-docker/bin/list-dependencies.sh /opt/guacamole/sbin/guacd /opt/guacamole/lib/libguac-client-*.so /usr/lib/freerdp3/*guac*.so > /opt/guacamole/DEPENDENCIES
FROM ${BASE}
RUN sed -i s/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g /etc/apk/repositories
COPY --from=build /opt/guacamole /opt/guacamole
COPY --from=build /usr/lib/freerdp3/*guac*.so /usr/lib/freerdp3/
RUN apk add --no-cache ca-certificates font-noto-cjk ghostscript netcat-openbsd shadow terminus-font ttf-dejavu ttf-liberation util-linux-login && \
    xargs apk add --no-cache < /opt/guacamole/DEPENDENCIES && \
    groupadd --gid 1000 guacd && useradd --system --create-home --shell /sbin/nologin --uid 1000 --gid 1000 guacd
ADD --checksum=sha256:e9d92102c6537a036cc3f4e27f97fe860f944f3b26565d9991bfdbe21c2a4caa https://dl-4.alpinelinux.org/alpine/edge/main/x86_64/alsa-lib-1.2.16.1-r0.apk /tmp/alsa-lib-1.2.16.1-r0.apk
RUN apk add --no-cache /tmp/alsa-lib-1.2.16.1-r0.apk && rm /tmp/alsa-lib-1.2.16.1-r0.apk
ENV LC_ALL=C.UTF-8 LD_LIBRARY_PATH=/opt/guacamole/lib
HEALTHCHECK --interval=5m --timeout=5s CMD nc -z 127.0.0.1 4822 || exit 1
USER guacd
EXPOSE 4822
COPY --from=build /src/src/guacd-docker/bin/entrypoint.sh /opt/guacamole/entrypoint.sh
COPY --from=build /src/LICENSE /src/NOTICE /opt/guacamole/licenses/
ENTRYPOINT ["/opt/guacamole/entrypoint.sh"]
