/**
 * Publish mobile/web to the VPS nginx /dshd/ alias.
 *
 * Env: DSHD_SSH_PASS (required), DSHD_SSH_HOST (default 125.124.85.212),
 *      DSHD_SSH_USER (default root), DSHD_SSH_PORT (default 22).
 *
 * Do not put DSHD_SSH_PASS in the repo, scripts, docs, or reports.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_ROOT = join(ROOT, 'mobile', 'web');
const REMOTE_ROOT = '/var/www/dshd-app';
const SNIPPET_PATH = '/etc/nginx/snippets/dshd-app.conf';
const DEFAULT_HOST = '125.124.85.212';
const DEFAULT_USER = 'root';

const NGINX_SNIPPET = [
  'location = /dshd { return 301 /dshd/; }',
  'location /dshd/ {',
  '    alias /var/www/dshd-app/;',
  '    add_header Cache-Control "no-cache";',
  '}',
  '',
].join('\n');

const PYTHON_WORKER = String.raw`
from __future__ import annotations

import json
import os
import posixpath
import re
import stat
import sys

import paramiko

host = os.environ.get("DSHD_SSH_HOST", "125.124.85.212")
port = int(os.environ.get("DSHD_SSH_PORT", "22"))
user = os.environ.get("DSHD_SSH_USER", "root")
password = os.environ.get("DSHD_SSH_PASS", "")
if not password:
    raise SystemExit("DSHD_SSH_PASS unset")

manifest_path = sys.argv[1]
manifest = json.loads(open(manifest_path, encoding="utf-8").read())
remote_root = manifest["remoteRoot"]
snippet_path = manifest["snippetPath"]
snippet_body = manifest["snippetBody"]
files = manifest["files"]


def ssh_exec(transport, command, check=True):
    session = transport.open_session()
    session.settimeout(120)
    session.exec_command(command)
    out = session.makefile("rb", -1).read()
    err = session.makefile_stderr("rb", -1).read()
    code = session.recv_exit_status()
    session.close()
    if out:
        sys.stdout.buffer.write(out)
        if not out.endswith(b"\n"):
            sys.stdout.buffer.write(b"\n")
    if err:
        sys.stderr.buffer.write(err)
        if not err.endswith(b"\n"):
            sys.stderr.buffer.write(b"\n")
    if check and code != 0:
        raise SystemExit(f"remote command failed ({code}): {command}")
    return code, out, err


def ensure_dir(sftp, path):
    parts = path.strip("/").split("/")
    cur = ""
    for part in parts:
        cur += "/" + part
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def inject_base(html: str) -> tuple[str, bool]:
    if re.search(r'<base\s+href=["\']/dshd/["\']', html, re.I):
        return html, False
    if "<head>" not in html:
        raise SystemExit("remote index.html has no <head>")
    return html.replace("<head>", '<head>\n  <base href="/dshd/">', 1), True


def stamp_asset_versions(html: str, stamp: str) -> tuple[str, int]:
    # Mobile WebViews cache aggressively regardless of Cache-Control; a fresh
    # ?v= on every deploy is the only reliable bust for app.css / app.js.
    pattern = re.compile(r'(href|src)=(["\'])(\./[^"\'?]+\.(?:css|m?js))(?:\?v=[^"\']*)?\2')
    count = 0

    def repl(match):
        nonlocal count
        count += 1
        return f'{match.group(1)}={match.group(2)}{match.group(3)}?v={stamp}{match.group(2)}'

    return pattern.sub(repl, html), count


def stamp_module_versions(source: str, stamp: str) -> tuple[str, int]:
    # ESM child modules have their own cache keys. Keep relative imports in
    # uploaded JavaScript on the same deploy stamp as index.html, otherwise a
    # fresh app.js can be evaluated with an older fold/tool module.
    pattern = re.compile(r'(from\s+|import\s*(?:\(\s*)?)(["\'])(\.{1,2}/[^"\'?]+\.m?js)(?:\?v=[^"\']*)?\2')
    count = 0

    def repl(match):
        nonlocal count
        count += 1
        return f'{match.group(1)}{match.group(2)}{match.group(3)}?v={stamp}{match.group(2)}'

    return pattern.sub(repl, source), count


def find_listen80_site(sftp):
    enabled = "/etc/nginx/sites-enabled"
    names = sftp.listdir(enabled)
    for name in names:
        link = posixpath.join(enabled, name)
        try:
            real = sftp.normalize(link)
        except OSError:
            real = link
        with sftp.open(real, "r") as fh:
            text = fh.read().decode("utf-8")
        if re.search(r"listen\s+80\b", text):
            return real, text
    raise SystemExit("no listen 80 site found under /etc/nginx/sites-enabled")


def insert_include_after_listen(text: str, listen_pat: str, needles: tuple[str, ...]) -> tuple[str, bool]:
    listen = re.search(listen_pat, text)
    if not listen:
        return text, False
    loc = -1
    chosen = ""
    for needle in needles:
        found = text.find(needle, listen.start())
        if found >= 0 and (loc < 0 or found < loc):
            loc = found
            chosen = needle
    if loc < 0:
        return text, False
    chunk = text[listen.start():loc]
    if "dshd-app.conf" in chunk:
        return text, False
    insert = "\n    include /etc/nginx/snippets/dshd-app.conf;"
    return text[:loc] + insert + text[loc:], True


def insert_include(text: str) -> tuple[str, bool]:
    changed = False
    text, c80 = insert_include_after_listen(
        text, r"listen\s+80\b", ("\n    location / {", "\n    location /")
    )
    changed = changed or c80
    text, c3389 = insert_include_after_listen(
        text, r"listen\s+3389\b", ("\n    location /hub/", "\n    location / {", "\n    location /")
    )
    changed = changed or c3389
    return text, changed


transport = paramiko.Transport((host, port))
transport.start_client(timeout=20)
try:
    transport.auth_password(user, password)
except paramiko.AuthenticationException as err:
    print(f"password failed: {err}", file=sys.stderr)
    transport.close()
    raise SystemExit(1)

sftp = paramiko.SFTPClient.from_transport(transport)
assert sftp is not None

print("=== inspect sites-enabled ===")
ssh_exec(transport, "ls -la /etc/nginx/sites-enabled")

site_path, site_text = find_listen80_site(sftp)
print("listen80_site", site_path)
print("=== inspect listen 80 server (pre-change) ===")
block = re.search(r"server\s*\{(?:[^{}]|\{[^{}]*\})*listen\s+80\b(?:[^{}]|\{[^{}]*\})*\}", site_text)
if block:
    print(block.group(0))
else:
    print(site_text[:800])
root_hits = re.findall(r"^\s*root\s+\S+", site_text, re.M)
if root_hits:
    print("existing root directives (unchanged):", ", ".join(root_hits))
else:
    print("no root directive on this site (proxy); will not add one")

ensure_dir(sftp, remote_root)
uploaded = 0
stamped_modules = 0
for item in files:
    rel = item["rel"].replace("\\", "/")
    dest = posixpath.join(remote_root, rel)
    ensure_dir(sftp, posixpath.dirname(dest))
    if rel.endswith(".js"):
        with open(item["local"], encoding="utf-8") as fh:
            source = fh.read()
        source, count = stamp_module_versions(source, manifest["deployStamp"])
        stamped_modules += count
        with sftp.open(dest, "w") as fh:
            fh.write(source.encode("utf-8"))
    else:
        sftp.put(item["local"], dest)
    sftp.chmod(dest, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
    print("put", rel)
    uploaded += 1
print("uploaded", uploaded, "files ->", remote_root)
print("stamped", stamped_modules, "relative JS module refs")

ssh_exec(transport, f"find {remote_root} -name '*.test.js' -type f -delete", check=False)

index_path = posixpath.join(remote_root, "index.html")
with sftp.open(index_path, "r") as fh:
    html = fh.read().decode("utf-8")
html, changed = inject_base(html)
html, stamped = stamp_asset_versions(html, manifest["deployStamp"])
if changed or stamped:
    with sftp.open(index_path, "w") as fh:
        fh.write(html.encode("utf-8"))
    sftp.chmod(index_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
    if changed:
        print("injected <base href=\"/dshd/\">")
    print(f"stamped {stamped} asset refs with ?v={manifest['deployStamp']}")
else:
    print("base already present; skipped inject")

with sftp.open(snippet_path, "w") as fh:
    fh.write(snippet_body.encode("utf-8"))
sftp.chmod(snippet_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
print("wrote", snippet_path)

patched, include_changed = insert_include(site_text)
if include_changed:
    backup = site_path + ".dshd-bak"
    with sftp.open(backup, "w") as fh:
        fh.write(site_text.encode("utf-8"))
    with sftp.open(site_path, "w") as fh:
        fh.write(patched.encode("utf-8"))
    print("included snippet in", site_path)
    code, out, err = ssh_exec(transport, "nginx -t", check=False)
    if code != 0:
        with sftp.open(site_path, "w") as fh:
            fh.write(site_text.encode("utf-8"))
        print("nginx -t failed; restored site file", file=sys.stderr)
        sftp.close()
        transport.close()
        raise SystemExit(code)
else:
    print("snippet include already present")
    ssh_exec(transport, "nginx -t")

ssh_exec(transport, "systemctl reload nginx")
print("nginx reloaded")

sftp.close()
transport.close()
print("deploy ok")
`;

function toPosixRel(filePath) {
  return relative(LOCAL_ROOT, filePath).split(sep).join('/');
}

function shouldSkip(relPosix) {
  return relPosix.split('/').some((part) => part.endsWith('.test.js'));
}

function collectFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    const rel = toPosixRel(full);
    if (shouldSkip(rel)) continue;
    acc.push({ local: full, rel });
  }
  return acc;
}

function findPython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];
  for (const bin of candidates) {
    const probe = spawnSync(bin, ['-c', 'import paramiko,sys; print(sys.executable)'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && probe.stdout.trim()) return bin;
  }
  return null;
}

const password = process.env.DSHD_SSH_PASS || '';
if (!password) {
  console.error('DSHD_SSH_PASS unset');
  process.exit(1);
}

console.log('不要把 DSHD_SSH_PASS 写进仓库');
console.log(
  `target ${process.env.DSHD_SSH_USER || DEFAULT_USER}@${process.env.DSHD_SSH_HOST || DEFAULT_HOST}`,
);

const files = collectFiles(LOCAL_ROOT).sort((a, b) => a.rel.localeCompare(b.rel));
if (!files.some((f) => f.rel === 'index.html')) {
  console.error('mobile/web/index.html missing');
  process.exit(1);
}
if (!files.some((f) => f.rel === 'host/backend.js') || !files.some((f) => f.rel === 'host/catalog.js')) {
  console.error('mobile/web/host/backend.js or catalog.js missing; host cutover must be uploaded');
  process.exit(1);
}
const appJs = readFileSync(join(LOCAL_ROOT, 'app.js'), 'utf8');
// #442: the SPA catalog call moved from app.js into app/session.js during the
// split; the guard checks its new home so a stale pre-split tree still fails.
const appSessionJs = readFileSync(join(LOCAL_ROOT, 'app', 'session.js'), 'utf8');
if (appJs.includes('fetchAgents') || appSessionJs.includes('fetchAgents')) {
  console.error('refuse to publish SPA sources that still mention fetchAgents');
  process.exit(1);
}
if (!appSessionJs.includes("hostCall(client, 'session.list'")) {
  console.error('refuse to publish SPA without hostCall session.list');
  process.exit(1);
}
console.log(`local files ${files.length} (excluded **/*.test.js only)`);

const python = findPython();
if (!python) {
  console.error('python + paramiko required (ssh2 not used)');
  process.exit(1);
}

const exitCode = await withOwnedTempDir('dshd-spa-deploy-', async (work) => {
  const workerPath = join(work, 'worker.py');
  const manifestPath = join(work, 'manifest.json');
  writeFileSync(workerPath, PYTHON_WORKER, 'utf8');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      remoteRoot: REMOTE_ROOT,
      snippetPath: SNIPPET_PATH,
      snippetBody: NGINX_SNIPPET,
      deployStamp: new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
      files,
    }),
    'utf8',
  );

  const result = spawnSync(python, [workerPath, manifestPath], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      DSHD_SSH_HOST: process.env.DSHD_SSH_HOST || DEFAULT_HOST,
      DSHD_SSH_USER: process.env.DSHD_SSH_USER || DEFAULT_USER,
      DSHD_SSH_PORT: process.env.DSHD_SSH_PORT || '22',
    },
  });
  return result.status === 0 ? 0 : result.status || 1;
});

if (exitCode !== 0) {
  process.exit(exitCode);
}
