#!/usr/bin/env bash
set -euo pipefail

sha=${1:?Expected commit SHA}
run=${2:?Expected run ID and attempt}
output=${3:-artifact}
[[ "$sha" =~ ^[a-f0-9]{40}$ && "$run" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
cd "$(git rev-parse --show-toplevel)"
[[ "$(git rev-parse HEAD)" == "$sha" ]] || { echo 'Commit mismatch' >&2; exit 2; }
[[ "$(node --version)" == v26.13.0 && "$(npm --version)" == 11.20.0 ]] || {
  echo 'Packaging requires Node 26.13.0 and npm 11.20.0' >&2
  exit 2
}

mkdir -p "$output"
output=$(cd "$output" && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/apps/server" "$stage/apps/web" \
  "$stage/packages/protocol" "$stage/packages/webgal-parser"
cp package.json package-lock.json "$stage/"
cp apps/server/package.json "$stage/apps/server/"
cp apps/web/package.json "$stage/apps/web/"
cp packages/protocol/package.json "$stage/packages/protocol/"
cp packages/webgal-parser/package.json "$stage/packages/webgal-parser/"
cp -R apps/server/dist "$stage/apps/server/"
cp -R packages/protocol/dist "$stage/packages/protocol/"
node --input-type=module - "$sha" "$run" > "$stage/release.json" <<'JS'
const [, , commit, run] = process.argv;
process.stdout.write(JSON.stringify({ commit, run, node: '26.13.0', npm: '11.20.0' }) + '\n');
JS
tar -C "$stage" -czf "$output/server.tar.gz" .
(cd "$output" && sha256sum server.tar.gz > server.tar.gz.sha256)
echo "Packaged backend commit $sha ($run)"
