#!/usr/bin/env python3
"""Run opt-in Vault integration only against new, loopback-bound disposable containers."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".tmp" / "NA-0203" / ("mysql-" + str(int(time.time())) + "-" + secrets.token_hex(3))
BASE = "bf122f141029244b0687f549353d79b4dcbaa506"
ENV = os.environ.copy()
NAMES = []
REDACTIONS = []
RESULT = {"change_id": "NA-0203", "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "schema_base_sha": BASE, "cleanup": False}


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, cwd=ROOT, env=ENV, **kwargs)


def sanitized(value):
    for secret in REDACTIONS:
        value = value.replace(secret, "[redacted-disposable]")
    return value


def fingerprint(artifact):
    paths = run(["git", "ls-files", "--cached", "--others", "--exclude-standard"]).stdout.splitlines()
    selected = sorted(p for p in paths if p.startswith(("apps/backend/src/", "packages/shared/src/", "apps/backend/prisma/migrations/", "tools/vault-security/")))
    digest = hashlib.sha256()
    manifest = {}
    for name in selected:
        path = ROOT / name
        if path.is_file():
            content = path.read_bytes()
            manifest[name] = hashlib.sha256(content).hexdigest()
            digest.update(name.encode() + b"\0" + content + b"\0")
    (OUT / artifact).write_text(json.dumps(manifest, indent=2) + "\n")
    return digest.hexdigest()


def log(name, completed):
    (OUT / name).write_text(sanitized(completed.stdout + completed.stderr))


def start_container(kind, image, port, extra):
    name = "na0178-vault-" + kind + "-" + secrets.token_hex(4)
    run(["docker", "image", "inspect", image])  # No implicit pull or changing image references.
    run(["docker", "run", "-d", "--rm", "--name", name, "--label", "nodeaccess.test=NA-0178", "-p", "127.0.0.1::" + port] + extra + [image])
    NAMES.append(name)
    state = json.loads(run(["docker", "inspect", name]).stdout)[0]
    RESULT[kind + "_image_id"] = state["Image"]
    return name, state["NetworkSettings"]["Ports"][port + "/tcp"][0]["HostPort"]


try:
    OUT.mkdir(parents=True, exist_ok=False)
    RESULT["source_sha"] = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    RESULT["source_scope"] = ["apps/backend/src/**", "packages/shared/src/**", "apps/backend/prisma/migrations/**", "tools/vault-security/**"]
    RESULT["source_files_before"] = "source-files-before.json"
    RESULT["source_files_after"] = "source-files-after.json"
    RESULT["working_tree_fingerprint"] = fingerprint(RESULT["source_files_before"])
    password = secrets.token_hex(24)
    signing_key = secrets.token_hex(32)
    encryption_key = secrets.token_hex(32)
    REDACTIONS.extend([password, signing_key, encryption_key])
    database = "na0178_" + secrets.token_hex(6)
    mysql, mysql_port = start_container("mysql", "nodeaccess-mysql:8.4.12-1", "3306", ["-e", "MYSQL_ROOT_PASSWORD=" + password, "-e", "MYSQL_ROOT_HOST=%", "-e", "MYSQL_DATABASE=" + database])
    redis, redis_port = start_container("redis", "nodeaccess-redis:8.2.10-1", "6379", [])
    for _ in range(90):
        ready = subprocess.run(["docker", "exec", "-e", "MYSQL_PWD=" + password, mysql, "mysql", "--protocol=TCP", "-h127.0.0.1", "-uroot", "-e", "SELECT 1"], capture_output=True, text=True)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("Disposable MySQL readiness timeout")
    for _ in range(30):
        ready = subprocess.run(["docker", "exec", redis, "redis-cli", "PING"], capture_output=True, text=True)
        if ready.returncode == 0 and "PONG" in ready.stdout:
            break
        time.sleep(1)
    else:
        raise RuntimeError("Disposable Redis readiness timeout")
    ENV.update(DATABASE_URL="mysql://root:" + password + "@127.0.0.1:" + mysql_port + "/" + database + "?connection_limit=24&pool_timeout=5", REDIS_URL="redis://127.0.0.1:" + redis_port,
               RUN_VAULT_MYSQL="true", VAULT_DISPOSABLE_NONCE=secrets.token_hex(12), NODE_ENV="test", JWT_SECRET=signing_key, PEM_ENCRYPTION_KEY=encryption_key, PEM_ENCRYPTION_PREVIOUS_KEYS="", PRISMA_LOG_QUERIES="false")
    # Rehearse the real additive migration over the integrated pre-Vault schema.
    schema = OUT / "baseline.prisma"
    schema.write_text(run(["git", "show", BASE + ":apps/backend/prisma/schema.prisma"]).stdout)
    setup = run(["node", "node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--schema", str(schema)], timeout=120)
    log("schema.log", setup)
    # NA-0183: the extension migration is rehearsed on top of the vault one, in deployment order.
    migrations = [ROOT / "apps/backend/prisma/migrations/20261116030000_add_vault_security/migration.sql",
                  ROOT / "apps/backend/prisma/migrations/20261120150000_vault_extension/migration.sql",
                  # NA-0193: trusted extension devices.
                  ROOT / "apps/backend/prisma/migrations/20261123170000_vault_extension_trust/migration.sql",
                  # NA-0198: Windows Hello / passkey credentials.
                  ROOT / "apps/backend/prisma/migrations/20261124020000_vault_webauthn/migration.sql",
                  ROOT / "apps/backend/prisma/migrations/20261124192900_extend_vault_grants/migration.sql",
                  ROOT / "apps/backend/prisma/migrations/20261124193000_add_vault_sites/migration.sql",
                  ROOT / "apps/backend/prisma/migrations/20261124233000_vault_fill_generation/migration.sql"]
    digest = hashlib.sha256()
    for migration in migrations:
        applied = run(["docker", "exec", "-i", "-e", "MYSQL_PWD=" + password, mysql, "mysql", "-uroot", database], input=migration.read_text(), timeout=60)
        log("migration-" + migration.parent.name + ".log", applied)
        digest.update(migration.read_bytes())
    RESULT["migration_sha256"] = digest.hexdigest()
    tests = subprocess.run(["node", "node_modules/vitest/vitest.mjs", "run", "apps/backend/src/modules/vault-security/vault.mysql.test.ts",
                            "apps/backend/src/modules/vault-security/vault-extension.mysql.test.ts",
                            "apps/backend/src/modules/vault-security/vault-sites.mysql.test.ts", "--reporter=default", "--reporter=json", "--outputFile=" + str(OUT / "tests.json")], cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=240)
    log("tests.log", tests)
    RESULT["exit_code"] = tests.returncode
    report = json.loads((OUT / "tests.json").read_text())
    RESULT["tests"] = {key: report.get(key) for key in ["numPassedTests", "numFailedTests", "numPendingTests"]}
    if tests.returncode != 0:
        RESULT["error"] = "Integration assertions failed; inspect private test artifacts"
except Exception as error:
    RESULT["error"] = type(error).__name__ + ": " + sanitized(str(error))[:300]
    RESULT["exit_code"] = 1
    if isinstance(error, subprocess.CalledProcessError):
        (OUT / "failure.log").write_text(sanitized((error.stdout or "") + (error.stderr or "")))
finally:
    cleanup = []
    for name in NAMES:
        removed = subprocess.run(["docker", "rm", "-f", "-v", name], capture_output=True, text=True)
        absent = subprocess.run(["docker", "inspect", name], capture_output=True, text=True)
        cleanup.append(removed.returncode == 0 and absent.returncode != 0)
    RESULT["cleanup"] = len(cleanup) == len(NAMES) and all(cleanup)
    RESULT["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    RESULT["final_working_tree_fingerprint"] = fingerprint(RESULT["source_files_after"])
    RESULT["source_changed_during_run"] = RESULT.get("working_tree_fingerprint") != RESULT["final_working_tree_fingerprint"]
    before = json.loads((OUT / RESULT["source_files_before"]).read_text())
    after = json.loads((OUT / RESULT["source_files_after"]).read_text())
    RESULT["changed_source_files"] = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    RESULT["artifacts"] = str(OUT.relative_to(ROOT))
    (OUT / "execution.json").write_text(json.dumps(RESULT, indent=2) + "\n")
    print(json.dumps(RESULT))
sys.exit(0 if RESULT.get("exit_code") == 0 and RESULT["cleanup"] else 1)
