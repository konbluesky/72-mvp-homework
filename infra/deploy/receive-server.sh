#!/usr/bin/env bash
# Install this file as root-owned /usr/local/libexec/72-mvp-deploy.
# The CI authorized_key must force this command and use the OpenSSH "restrict" option.
set -euo pipefail
umask 077

root=/home/ubuntu/work/72-mvp-homework
service=72-mvp-api.service
export PATH="$root/runtime/node-v26.13.0-linux-x64/bin:/usr/bin:/bin"

if [[ "${SSH_ORIGINAL_COMMAND:-}" == status ]]; then
  readlink -f "$root/current"
  cat "$root/current/release.json"
  systemctl is-active "$service"
  exit
fi
if [[ ! "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([a-f0-9]{40})\ ([0-9]+-[0-9]+)\ ([a-f0-9]{64})$ ]]; then
  echo 'Only a backend deployment or status request is allowed.' >&2
  exit 2
fi
sha=${BASH_REMATCH[1]}
run=${BASH_REMATCH[2]}
digest=${BASH_REMATCH[3]}
release="$root/releases/$sha-$run"
incoming="$root/shared/incoming-$run.tar.gz"
link="$root/.current-$run"
previous=''
switched=0
expected_mode=''

exec 9> "$root/shared/deploy.lock"
flock -w 900 9 || { echo 'Another backend deployment is still running.' >&2; exit 1; }
[[ ! -e "$release" && ! -L "$release" ]] || { echo 'Release already exists.' >&2; exit 1; }
[[ -L "$root/current" ]] || { echo 'Expected an existing current release.' >&2; exit 1; }
previous=$(readlink -f "$root/current")
[[ "$previous" == "$root/releases/"* && -d "$previous" ]] || exit 1

ready() {
  local target=$1 pid cwd
  [[ "$(readlink -f "$root/current")" == "$target" ]] || return 1
  systemctl is-active --quiet "$service" || return 1
  pid=$(systemctl show "$service" --property=MainPID --value)
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  cwd=$(readlink -f "/proc/$pid/cwd") || return 1
  [[ "$cwd" == "$target" ]] || return 1
  curl -fsS --max-time 5 http://127.0.0.1:3072/healthz > /dev/null || return 1
  curl -fsS --max-time 5 http://127.0.0.1:3072/readyz |
    python3 -c 'import json,sys; r=json.load(sys.stdin); sys.exit(0 if r.get("status")=="ready" and r.get("mode")==sys.argv[1] else 1)' "$expected_mode"
}

wait_ready() {
  local target=$1
  for ((attempt=0; attempt<20; attempt++)); do
    if ready "$target" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

finish() {
  local result=$?
  trap - EXIT INT TERM HUP
  set +e
  rm -f "$incoming" "$link"
  if (( result != 0 && switched == 1 )); then
    if [[ "$(readlink -f "$root/current")" == "$release" ]]; then
      echo 'Deployment failed; restoring the previous backend release.' >&2
      ln -s "$previous" "$link" && mv -Tf "$link" "$root/current"
      if sudo -n systemctl restart "$service" && wait_ready "$previous"; then
        echo "Rollback healthy: $previous" >&2
      else
        echo 'Rollback needs operator attention.' >&2
      fi
    else
      echo 'The current release changed elsewhere; leaving that deployment untouched.' >&2
    fi
  fi
  rm -f "$link"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# Bound the compressed upload and validate its hash before unpacking anything.
timeout 120 head -c 67108865 > "$incoming"
(( $(stat -c %s "$incoming") <= 67108864 )) || { echo 'Upload exceeds 64 MiB.' >&2; exit 1; }
printf '%s  %s\n' "$digest" "$incoming" | sha256sum --check --status
mkdir "$release"
python3 - "$incoming" "$release" "$sha" "$run" <<'PY'
import json, sys, tarfile
from pathlib import PurePosixPath
archive, destination, commit, run = sys.argv[1:]
files = {
    'package.json', 'package-lock.json', 'release.json',
    'apps/server/package.json', 'apps/web/package.json',
    'packages/protocol/package.json', 'packages/webgal-parser/package.json',
}
prefixes = ('apps/server/dist/', 'packages/protocol/dist/', 'assets/mock-audio/')
parents = {'.', 'apps', 'apps/server', 'apps/web', 'packages', 'packages/protocol',
           'packages/webgal-parser', 'assets', *(p.rstrip('/') for p in prefixes)}
with tarfile.open(archive, 'r:gz') as bundle:
    members = bundle.getmembers()
    if len(members) > 5000 or sum(m.size for m in members) > 268435456:
        raise SystemExit('Release exceeds unpacked limits')
    seen = set()
    for member in members:
        path = PurePosixPath(member.name)
        name = str(path)
        if path.is_absolute() or '..' in path.parts or any(p.startswith('.env') for p in path.parts):
            raise SystemExit('Unsafe archive path')
        if member.isdir():
            allowed = name in parents or name.startswith(prefixes)
        else:
            allowed = member.isfile() and (name in files or name.startswith(prefixes))
        if not allowed or name in seen:
            raise SystemExit('Unexpected archive entry')
        seen.add(name)
    if not files.issubset(seen):
        raise SystemExit('Release metadata or package manifests missing')
    metadata = next(m for m in members if str(PurePosixPath(m.name)) == 'release.json')
    meta = json.load(bundle.extractfile(metadata))
    if meta != {'commit': commit, 'run': run, 'node': '26.13.0', 'npm': '11.20.0'}:
        raise SystemExit('Release identity or runtime mismatch')
    bundle.extractall(destination, filter='data')
PY

cd "$release"
[[ "$(node --version)" == v26.13.0 && "$(npm --version)" == 11.20.0 ]]
timeout 480 npm ci --omit=dev --workspace=@mira/server --workspace=@mira/protocol \
  --ignore-scripts --no-audit --no-fund
ln -s "$root/shared/server.env" apps/server/.env

# Parse both production configuration layers without starting providers or printing secrets.
set -a
source "$root/shared/production.env"
set +a
expected_mode=$(node --input-type=module <<'JS'
import { config } from 'dotenv';
import { loadConfig } from './apps/server/dist/config/index.js';
config({ path: './apps/server/.env', quiet: true });
process.stdout.write(loadConfig().APP_MODE);
JS
)
ln -s "$release" "$link"
switched=1
mv -Tf "$link" "$root/current"
sudo -n systemctl restart "$service"
wait_ready "$release"
curl -fsS --max-time 8 --resolve api-72-mvp.telegrow.app:443:127.0.0.1 \
  https://api-72-mvp.telegrow.app/healthz > /dev/null
printf 'Backend healthy: %s (%s)\n' "$sha" "$run"
