#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"; trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/bin"; AWS_LOG="$WORK_DIR/aws.log"
cat >"$WORK_DIR/bin/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
: "${AWS_LOG:?}"; printf '%q ' "$@" >>"$AWS_LOG"; printf '\n' >>"$AWS_LOG"
if [[ "$*" == *"s3api get-bucket-versioning"* ]]; then printf '%s\n' "${FAKE_VERSIONING_STATUS:-Enabled}"; exit 0; fi
if [[ "$*" == *"s3api put-object"* ]]; then
  key=""; while (($#)); do if [[ "$1" == "--key" ]]; then key="${2:-}"; break; fi; shift; done
  [[ "$key" == *agentcore-runtime.zip ]] && { echo runtime-version-1; exit 0; }
  [[ "$key" == *control-plane-lambda.zip ]] && { echo control-version-1; exit 0; }
fi
exit 93
AWS
chmod +x "$WORK_DIR/bin/aws"
python3 - "$WORK_DIR/runtime.zip" "$WORK_DIR/control.zip" <<'PY'
import sys,zipfile
for output,entries in ((sys.argv[1],("runtime-http.mjs",)),(sys.argv[2],("control-plane-lambda.mjs","capture-completion-lambda.mjs","dispatcher-lambda.mjs"))):
    with zipfile.ZipFile(output,"w") as z:
        for e in entries: z.writestr(e,"export {};\n")
        z.writestr("dist/index.js","export {};\n"); z.writestr("package.json",'{"type":"module"}\n')
PY
export PATH="$WORK_DIR/bin:$PATH" AWS_LOG
manifest="$WORK_DIR/release.json"
bash "$ROOT_DIR/scripts/release-aws-artifacts.sh" --bucket automation-release-bucket --release-id abc123 --prefix releases/automation --region ap-south-1 --runtime-zip "$WORK_DIR/runtime.zip" --control-plane-zip "$WORK_DIR/control.zip" --output "$manifest" >/dev/null
python3 - "$manifest" <<'PY'
import json,sys
from pathlib import Path
m=json.loads(Path(sys.argv[1]).read_text())
assert m["schemaVersion"]==1 and m["releaseId"]=="abc123" and m["region"]=="ap-south-1"
assert m["artifacts"]["agentCoreRuntime"]["versionId"]=="runtime-version-1"
assert m["artifacts"]["controlPlaneLambda"]["versionId"]=="control-version-1"
assert m["cloudFormationParameters"]["controlPlaneService"]["CodeObjectVersion"]=="control-version-1"
PY
grep -q get-bucket-versioning "$AWS_LOG"; [[ "$(grep -c put-object "$AWS_LOG")" -eq 2 ]]; grep -q -- '--if-none-match \\*' "$AWS_LOG"
# A prebuilt control-plane artifact that omits the scheduled dispatcher must be rejected before upload.
python3 - "$WORK_DIR/bad-control.zip" <<'PY'
import sys,zipfile
with zipfile.ZipFile(sys.argv[1],"w") as z:
    z.writestr("control-plane-lambda.mjs","export {};\n"); z.writestr("capture-completion-lambda.mjs","export {};\n"); z.writestr("dist/index.js","export {};\n"); z.writestr("package.json",'{"type":"module"}\n')
PY
: >"$AWS_LOG"
if bash "$ROOT_DIR/scripts/release-aws-artifacts.sh" --bucket automation-release-bucket --release-id bad --runtime-zip "$WORK_DIR/runtime.zip" --control-plane-zip "$WORK_DIR/bad-control.zip" --output "$WORK_DIR/bad.json" >/dev/null 2>&1; then echo "release unexpectedly accepted artifact without dispatcher" >&2; exit 1; fi
[[ "$(grep -c put-object "$AWS_LOG" || true)" -eq 0 ]]
: >"$AWS_LOG"
if FAKE_VERSIONING_STATUS=Suspended bash "$ROOT_DIR/scripts/release-aws-artifacts.sh" --bucket automation-release-bucket --release-id blocked --runtime-zip "$WORK_DIR/runtime.zip" --control-plane-zip "$WORK_DIR/control.zip" --output "$WORK_DIR/blocked.json" >/dev/null 2>&1; then echo "release unexpectedly succeeded for non-versioned bucket" >&2; exit 1; fi
[[ "$(grep -c put-object "$AWS_LOG" || true)" -eq 0 ]]
printf 'release-aws-artifacts tests passed\n'
