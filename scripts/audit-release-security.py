"""Heuristic scan of tracked text and all reachable Git blobs. Never prints matched secret values."""
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

rules = {
    "private-key-pem": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github-token": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})"),
    "cloud-access-key": re.compile(r"(?:AKIA|ASIA)[A-Z0-9]{16}"),
    "assigned-wallet-key": re.compile(r"(?i)(?:private[_-]?key|secret[_-]?key)\s*[:=]\s*['\"]?(?:0x)?[a-f0-9]{64}(?![a-f0-9])"),
    "assigned-seed": re.compile(r"(?i)(?:mnemonic|seed[_-]?phrase)\s*[:=]\s*['\"](?:[a-z]+\s+){11,23}[a-z]+['\"]"),
}
findings = []
tracked = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
text_count = 0
for name in filter(None, tracked):
    path = Path(name)
    if path.name.startswith('.env') and not path.name.endswith('.example'):
        findings.append({"kind": "tracked-environment", "path": name})
    if not path.is_file():
        continue
    try:
        content = path.read_text(encoding='utf-8')
    except (UnicodeError, OSError):
        continue
    text_count += 1
    for kind, pattern in rules.items():
        if pattern.search(content):
            findings.append({"kind": kind, "path": name, "scope": "worktree"})

objects = subprocess.check_output(["git", "rev-list", "--objects", "--all"]).decode().splitlines()
blob_count = 0
for entry in objects:
    oid, _, name = entry.partition(' ')
    kind = subprocess.check_output(["git", "cat-file", "-t", oid]).strip()
    if kind != b'blob':
        continue
    raw = subprocess.check_output(["git", "cat-file", "blob", oid])
    if b'\0' in raw:
        continue
    try:
        content = raw.decode('utf-8')
    except UnicodeError:
        continue
    blob_count += 1
    for rule, pattern in rules.items():
        if pattern.search(content):
            findings.append({"kind": rule, "path": name, "scope": "history", "object": oid[:12]})
result = {"checkedAt": datetime.now(timezone.utc).isoformat(), "scope": "Tracked text and all reachable Git history", "trackedTextFiles": text_count, "historicalTextBlobs": blob_count, "findings": findings, "limits": "Heuristic pattern scan, not proof of absence of every credential. Ignored local state is not published or scanned."}
Path('docs/final-security-scan.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
print(json.dumps({"trackedTextFiles": text_count, "historicalTextBlobs": blob_count, "findingCount": len(findings)}))
raise SystemExit(bool(findings))
