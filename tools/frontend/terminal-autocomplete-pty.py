"""Opt-in local Bash/Readline PTY check; never connects to a user host."""
import json, os, pty, select, signal, sys, tempfile, time

cases = json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='nodeaccess-autocomplete-pty-') as directory:
    capture = os.path.join(directory, 'line')
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(PS1='NA_READY> ', INPUTRC='/dev/null', HISTFILE='/dev/null', NA_CAPTURE=capture, TERM='xterm')
        os.execvp('bash', ['bash', '--noprofile', '--norc', '-i'])
    def drain(seconds=0.1):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if select.select([fd], [], [], max(0, deadline-time.monotonic()))[0]:
                os.read(fd, 65536)
    try:
        drain(0.3)
        os.write(fd, b'''set -o emacs; bind -x '"\\C-x\\C-t":printf "%s" "$READLINE_LINE" > "$NA_CAPTURE"'\n''')
        drain(0.2)
        for case in cases:
            if os.path.exists(capture): os.unlink(capture)
            os.write(fd, b'\x03')
            drain()
            os.write(fd, (case['line'] + '\x01' + '\x06'*case['cursor']).encode())
            drain()
            os.write(fd, case['insertion'].encode())
            drain()
            os.write(fd, b'\x18\x14')
            drain(0.2)
            with open(capture) as source: actual = source.read()
            assert actual == case['expected'], (case['name'], repr(actual), repr(case['expected']))
        print(json.dumps({'result': 'passed', 'shell': 'Bash/Readline emacs', 'cases': len(cases), 'automaticExecution': False}))
    finally:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        os.close(fd)
