#!/usr/bin/env python3
"""Restore only NA-0038 files; dry run by default. Never touches databases or Git."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    evidence = root / 'docs/reviews/evidence/2026-10-05-engineering-hardening'
    manifest = json.loads((evidence / 'rollback-manifest.json').read_text())
    branch = subprocess.check_output(['git', 'symbolic-ref', '--short', 'HEAD'], cwd=root, text=True).strip()
    if branch != manifest['branch']:
        raise SystemExit('Branch differs from validated branch; nothing restored.')
    archive_bytes = (evidence / 'pre-change-files.tar.gz').read_bytes()
    if digest(archive_bytes) != manifest['archiveSha256']:
        raise SystemExit('Snapshot checksum differs; nothing restored.')
    pending = []
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:gz') as archive:
        for item in manifest['files']:
            relative = Path(item['path'])
            if relative.is_absolute() or '..' in relative.parts:
                raise SystemExit('Unsafe snapshot path; nothing restored.')
            target = root / relative
            if target.resolve() != target.absolute():
                raise SystemExit(f'Symlink path rejected: {relative}; nothing restored.')
            current = digest(target.read_bytes()) if target.is_file() else None
            if current != item['testedSha256']:
                raise SystemExit(f'File changed since validation: {relative}; nothing restored.')
            original = None
            if item['originalSha256'] is not None:
                member = archive.getmember(item['path'])
                if not member.isfile():
                    raise SystemExit('Invalid archive member; nothing restored.')
                original = archive.extractfile(member).read()
                if digest(original) != item['originalSha256']:
                    raise SystemExit('Original checksum differs; nothing restored.')
            pending.append((target, original))
    print(f'Validated {len(pending)} files; unrelated local work is preserved.')
    if not args.apply:
        print('Dry run only. Stop running services before an authorized --apply.')
        return
    for target, original in pending:
        if original is None:
            target.unlink()
        else:
            target.write_bytes(original)
    print('Source restored. Regenerate Prisma and rebuild before restarting services.')
    print('Database unchanged. Review PROCESSING jobs and uncertain remote effects before rollback.')


if __name__ == '__main__':
    main()
