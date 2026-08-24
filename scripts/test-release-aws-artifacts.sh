#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; mkdir -p "$W/bin"; AWS_LOG="$W/aws.log"
cat >"$W/bin/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >>"$AWS_LOG"; printf '\n' >>"$AWS_LOG"
[[ "$*" == *'get-bucket-versioning'* ]] && { echo "${FAKE_VERSIONING_STATUS:-Enabled}"; exit 0; }
if [[ "$*" == *'put-object'* ]]; then key=""; while (($#)); do [[ "$1" == --key ]] && { key="$2";break; };shift;done; case "$key" in *agentcore-runtime.zip) echo runtime-v;; *control-plane-lambda.zip) echo control-v;; *web-lambda.zip) echo web-v;; *) exit 92;; esac; exit 0; fi
exit 93
AWS
chmod +x "$W/bin/aws"; export PATH="$W/bin:$PATH" AWS_LOG
python3 - "$W/runtime.zip" "$W/control.zip" "$W/web.zip" <<'PY'
import sys,zipfile
entries=[('runtime-http.mjs','dist/index.js','package.json'),('control-plane-lambda.mjs','capture-completion-lambda.mjs','dispatcher-lambda.mjs','dist/index.js','package.json'),('run.sh','server.js')]
for p,es in zip(sys.argv[1:],entries):
 with zipfile.ZipFile(p,'w') as z:
  for e in es:z.writestr(e,'x')
PY
m="$W/release.json"; bash "$ROOT_DIR/scripts/release-aws-artifacts.sh" --bucket automation-release-bucket --release-id abc123 --region ap-south-1 --runtime-zip "$W/runtime.zip" --control-plane-zip "$W/control.zip" --web-zip "$W/web.zip" --output "$m" >/dev/null
python3 - "$m" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); assert m['artifacts']['webLambda']['versionId']=='web-v'; assert m['cloudFormationParameters']['webApp']['WebCodeObjectVersion']=='web-v'
PY
[[ "$(grep -c put-object "$AWS_LOG")" -eq 3 ]]; grep -q -- '--if-none-match \\*' "$AWS_LOG"
: >"$AWS_LOG"; if FAKE_VERSIONING_STATUS=Suspended bash "$ROOT_DIR/scripts/release-aws-artifacts.sh" --bucket automation-release-bucket --release-id blocked --runtime-zip "$W/runtime.zip" --control-plane-zip "$W/control.zip" --web-zip "$W/web.zip" --output "$W/x.json" >/dev/null 2>&1; then exit 1; fi; [[ "$(grep -c put-object "$AWS_LOG" || true)" -eq 0 ]]
echo 'release-aws-artifacts tests passed'
