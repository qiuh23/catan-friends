#!/usr/bin/env bash
# Run only in the unprivileged Linux Checks job, after build and Worker dry-run.
set -euo pipefail
COMMIT=${1:?full checked SHA}
RUN_ID=${2:?Checks run ID}
OUTPUT=${3:?fresh absolute output directory}
[[ $COMMIT =~ ^[a-f0-9]{40}$ && $RUN_ID =~ ^[1-9][0-9]*$ && $OUTPUT == /* && ! -e $OUTPUT ]]
[[ $(git rev-parse HEAD) == "$COMMIT" && $(uname -s) == Linux && $(uname -m) == x86_64 && $(node -p 'process.versions.node.split(".")[0]') == 24 ]]
[[ -f dist/index.html && -f .local/worker/index.js ]]
node --input-type=module - "$COMMIT" <<'JS'
import fs from 'node:fs';
const marker = JSON.parse(fs.readFileSync('dist/build-info.json'));
if (marker.revision !== process.argv[2] || marker.repository !== 'qiuh23/catan-friends' || marker.siteEdition !== 'global') throw Error('Built assets do not match checked source.');
JS
mkdir -p "$OUTPUT/node" "$OUTPUT/worker/assets" "$OUTPUT/worker/worker"
cp -R dist/. "$OUTPUT/worker/assets/"
cp .local/worker/index.js "$OUTPUT/worker/worker/index.js"
# Same checked source, two explicitly different site builds.
npm run build:cn
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
cp package.json package-lock.json "$WORK/"
cp -R dist server shared "$WORK/"
npm ci --omit=dev --ignore-scripts --prefix "$WORK"
# No executable symlinks or development packages are needed by the Node service.
rm -rf -- "$WORK/node_modules/.bin"
node --input-type=module - "$WORK" "$COMMIT" "$RUN_ID" <<'JS'
import fs from 'node:fs';
const [work,commit,runId] = process.argv.slice(2);
fs.writeFileSync(`${work}/release.json`, JSON.stringify({schema:1,stateSchema:3,repository:'qiuh23/catan-friends',commit,runId:Number(runId),platform:'linux',arch:'x64',nodeMajor:24,siteEdition:'cn'})+'\n');
JS
tar -czf "$OUTPUT/node/catan.tar.gz" -C "$WORK" dist server shared node_modules package.json package-lock.json release.json
(cd "$OUTPUT/node" && sha256sum catan.tar.gz > catan.tar.gz.sha256)
node --input-type=module - "$WORK/release.json" "$OUTPUT/worker/release.json" <<'JS'
import fs from 'node:fs';
const marker=JSON.parse(fs.readFileSync(process.argv[2]));
fs.writeFileSync(process.argv[3],JSON.stringify({...marker,siteEdition:'global'})+'\n');
JS
