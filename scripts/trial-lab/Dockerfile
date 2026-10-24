FROM alpine:3.22
RUN sed -i 's/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g' /etc/apk/repositories \
 && apk add --no-cache openssh-server bash \
 && adduser -D -h /home/demo -s /bin/bash demo \
 && mkdir /opt/lab-etc \
 && cp -a /etc/. /opt/lab-etc/
COPY entrypoint.sh /usr/local/bin/trial-entrypoint
RUN chmod 755 /usr/local/bin/trial-entrypoint
EXPOSE 2222
ENTRYPOINT ["/usr/local/bin/trial-entrypoint"]
