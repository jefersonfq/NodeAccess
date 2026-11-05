"""Independent RFC 9887 probe using only Python's standard library.

TLS peer validation (including CRLs and server SAN) is mandatory. No legacy
obfuscation, third-party TACACS client, plaintext fallback, or session reuse.
"""
import json
import secrets
import socket
import ssl
import struct
import sys

MAX_BODY = 8192


def receive_exact(connection, length):
    result = bytearray()
    while len(result) < length:
        chunk = connection.recv(length - len(result))
        if not chunk:
            raise EOFError('Truncated TACACS response')
        result.extend(chunk)
    return bytes(result)


def exchange(connection, session, version, kind, sequence, body):
    if len(body) > MAX_BODY:
        raise ValueError('Oversized request')
    connection.sendall(struct.pack('!BBBBII', version, kind, sequence, 1, session, len(body)) + body)
    reply = struct.unpack('!BBBBII', receive_exact(connection, 12))
    if reply[:3] != (version, kind, sequence + 1) or reply[3] & 1 != 1 or reply[3] & ~5 or reply[4] != session or reply[5] > MAX_BODY:
        raise ValueError('Invalid TACACS response header')
    return receive_exact(connection, reply[5])


def octets(value):
    result = value.encode('utf-8')
    if len(result) > 255:
        raise ValueError('Field too long')
    return result


def complete(connection, result):
    # Send TLS close_notify after the complete reply; do not report clean traffic
    # as an abrupt transport failure in the server's operational metrics.
    connection.unwrap().close()
    return result


def authentication(connection, request, session):
    ascii_mode = request['action'] == 'ascii'
    username = octets(request.get('username', 'alice'))
    password = octets(request.get('password', 'disposable-aaa-password'))
    data = b'' if ascii_mode else password
    version = 0xc0 if ascii_mode else 0xc1
    body = bytes([1, 1, 1 if ascii_mode else 2, 1, len(username), 0, 0, len(data)]) + username + data
    sequence = 1
    response = exchange(connection, session, version, 1, sequence, body)
    while True:
        if len(response) < 6:
            raise ValueError('Short authentication reply')
        status, _, message_length, data_length = struct.unpack('!BBHH', response[:6])
        if len(response) != 6 + message_length + data_length:
            raise ValueError('Invalid authentication lengths')
        if status not in (4, 5):
            return complete(connection, {'valid': status == 1, 'status': status})
        if not ascii_mode or sequence >= 5:
            raise ValueError('Unexpected authentication continuation')
        answer = username if status == 4 else password
        sequence += 2
        response = exchange(connection, session, version, 1, sequence, struct.pack('!HHB', len(answer), 0, 0) + answer)


def run(request):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.maximum_version = ssl.TLSVersion.TLSv1_3
    context.verify_mode = ssl.CERT_REQUIRED
    context.check_hostname = True
    context.hostname_checks_common_name = False
    context.load_verify_locations(cafile=request['ca'])
    context.load_verify_locations(cafile=request['crl'])
    context.verify_flags |= ssl.VERIFY_CRL_CHECK_CHAIN
    context.load_cert_chain(certfile=request['cert'], keyfile=request['key'])
    host = request.get('host', '127.0.0.1')
    server_name = request.get('serverName', 'localhost')
    session = secrets.randbits(32)
    with socket.create_connection((host, request['port']), timeout=3) as tcp:
        with context.wrap_socket(tcp, server_hostname=server_name) as connection:
            if connection.version() != 'TLSv1.3':
                raise ValueError('TLS 1.3 required')
            if request['action'] in ('ascii', 'pap'):
                return authentication(connection, request, session)
            username = octets(request.get('username', 'alice'))
            args = [octets(arg) for arg in request.get('args', [])]
            if len(args) > 64:
                raise ValueError('Too many arguments')
            accounting = request['action'] == 'accounting'
            if not accounting and request['action'] != 'authorize':
                raise ValueError('Unknown action')
            body = bytes([6, 1, 1, 1, len(username), 0, 0, len(args)]) + bytes(map(len, args)) + username + b''.join(args)
            if accounting:
                body = bytes([request.get('flags', 2)]) + body
            response = exchange(connection, session, 0xc0, 3 if accounting else 2, 1, body)
            if accounting:
                if len(response) < 5:
                    raise ValueError('Short accounting reply')
                message_length, data_length, status = struct.unpack('!HHB', response[:5])
                if len(response) != 5 + message_length + data_length:
                    raise ValueError('Invalid accounting lengths')
                return complete(connection, {'valid': status == 1, 'status': status})
            if len(response) < 6:
                raise ValueError('Short authorization reply')
            status, count, message_length, data_length = struct.unpack('!BBHH', response[:6])
            if len(response) < 6 + count or len(response) != 6 + count + message_length + data_length + sum(response[6:6 + count]):
                raise ValueError('Invalid authorization lengths')
            return complete(connection, {'valid': status in (1, 2), 'status': status})


if __name__ == '__main__':
    try:
        print(json.dumps(run(json.loads(sys.stdin.read()))))
    except Exception as error:
        # Never return credentials, filenames, certificate text or raw TLS errors.
        print(json.dumps({'valid': False, 'unavailable': True, 'errorType': type(error).__name__}))
