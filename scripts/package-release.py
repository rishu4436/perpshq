"""Package the reviewed working source, demo and evidence without local state or credentials."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
out = root / 'apps/web/public/release/perpshq-submission.zip'
out.parent.mkdir(parents=True, exist_ok=True)
files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
selected = []
for name in sorted(set(filter(None, files))):
    path = root / name
    if not path.is_file() or name.startswith(('data/', '.vercel/', 'server-build/', 'node_modules/')):
        continue
    if name == 'apps/web/public/release/package-manifest.json':
        continue
    if (path.name.startswith('.env') and path.name != '.env.example') or path.suffix.lower() in {'.mp4', '.webm', '.zip', '.sqlite', '.db'}:
        continue
    if path.stat().st_size > 5_000_000:
        continue
    try:
        text = path.read_text(encoding='utf-8')
        if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}', text):
            raise RuntimeError(f'Credential-like content in {name}; packaging stopped')
    except UnicodeDecodeError:
        pass
    selected.append((path, 'source/' + name))
for source, dest in [
    ('apps/web/public/release/perpshq-demo.mp4', 'demo/perpshq-demo.mp4'),
    ('apps/web/public/release/captions.vtt', 'demo/captions.vtt'),
    ('docs/RELEASE-2026-11-10.md', 'RELEASE.md'),
    ('data/release-verification/hosted-api.json', 'verification/hosted-api.json'),
    ('data/release-verification/hosted-browser.json', 'verification/hosted-browser.json'),
    ('data/release-verification/media.json', 'verification/media.json'),
    ('data/hosted-agent-studio/live-api.json', 'verification/hosted-agent-api.json'),
    ('data/hosted-agent-studio/database-verification.json', 'verification/database.json'),
    ('data/release-audit-final-2026-11-10.json', 'verification/npm-audit.json'),
    ('data/submission-demo-hosted-2026-11-10/manifest.json', 'demo/manifest.json'),
]:
    path = root / source
    if not path.is_file():
        raise RuntimeError(f'Required release evidence missing: {source}')
    selected.append((path, dest))
with ZipFile(out, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
    for path, name in selected:
        archive.write(path, name)
    archive.writestr('START-HERE.txt', 'PerpsHQ reviewer package\nWebsite: https://perpshq.vercel.app\nWorkspace: https://perpshq.vercel.app/app\nRead RELEASE.md, then source/docs/SUBMISSION.md.\nCurrent source is in source/. Node 24: npm ci, npm run build, npm start.\nRepository: https://github.com/rishu4436/perpshq. No server secrets or local databases are included.\n')
with ZipFile(out) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('ZIP integrity check failed')
    names = archive.namelist()
    if any('/.env' in n and not n.endswith('/.env.example') for n in names):
        raise RuntimeError('Environment file included')
manifest = {'files': len(names), 'bytes': out.stat().st_size, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}
(out.parent / 'package-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest))
