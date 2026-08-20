#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$WORK_DIR/bin"
AWS_LOG="$WORK_DIR/aws.log"
cat >"$WORK_DIR/bin/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
: "${AWS_LOG:?}"
printf '%q ' "$@" >>"$AWS_LOG"
printf '\n' >>"$AWS_LOG"

if [[ "$*" == *"s3api get-bucket-versioning"* ]]; then
  printf '%s\n' "${FAKE_VERSIONING_STATUS:-Enabled}"
  exit 0
fi
if [[ "$*" == *"s3api put-object"* ]]; then
  key=""
  while (($#)); do
    if [[ "$1" == "--key" ]]; then key="${2:-}"; break; fi
    shift
  done
  [[ -n "$key" ]] || exit 91
  if [[ "$key" == *"agentcore-runtime.zip" ]]; then
    printf 'runtime-version-1\n'
  elif [[ "$key" == *"control-plane-lambda.zip" ]]; then
    printf 'control-version-1\n'
  else
    exit 92
  fi
  exit 0
fi
exit 93
AWS
chmod +x "$WORK_DIR/bin/aws"

python3 - "$WORK_DIR/runtime.zip" "$WORK_DIR/control.zip" <<'PY'
import sys
import zipfile

artifacts = (
    (sys.argv[1], ("runtime-http.mjs",)),
    (sys.argv[2], ("control-plane-lambda.mjs", "capture-completion-lambda.mjs")),
)
for output, entrypoints in artifacts:
    with zipfile.ZipFile(output, "w") as archive:
        for entrypoint in entrypoints:
            archive.writestr(entrypoint, "export {};\n")
        archive.writestr("dist/index.js", "export {};\n")
        archive.writestr("package.json", '{"type":"module"}\n')
PY

export PATH="$WORK_DIR/bin:$PATH"
export AWS_LOG
manifest="$WORK_DIR/release.json"

bash "$ROOT_DIR/scripts/release-aws-artifacts.sh" \
  --bucket automation-release-bucket \
  --release-id abc123 \
  --prefix releases/automation \
  --region ap-south-1 \
  --runtime-zip "$WORK_DIR/runtime.zip" \
  --control-plane-zip "$WORK_DIR/control.zip" \
  --output "$manifest" >/dev/null

python3 - "$manifest" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
assert manifest["schemaVersion"] == 1
assert manifest["releaseId"] == "abc123"
assert manifest["region"] == "ap-south-1"
assert manifest["artifacts"]["agentCoreRuntime"]["key"] == "releases/automation/abc123/agentcore-runtime.zip"
assert manifest["artifacts"]["agentCoreRuntime"]["versionId"] == "runtime-version-1"
assert len(manifest["artifacts"]["agentCoreRuntime"]["sha256"]) == 64
assert manifest["artifacts"]["controlPlaneLambda"]["versionId"] == "control-version-1"
assert manifest["cloudFormationParameters"]["agentCoreRuntime"] == {
    "RuntimeCodeBucket": "automation-release-bucket",
    "RuntimeCodePrefix": "releases/automation/abc123/agentcore-runtime.zip",
    "RuntimeCodeVersionId": "runtime-version-1",
}
assert manifest["cloudFormationParameters"]["controlPlaneService"] == {
    "CodeBucketName": "automation-release-bucket",
    "CodeObjectKey": "releases/automation/abc123/control-plane-lambda.zip",
    "CodeObjectVersion": "control-version-1",
}
PY

grep -q 'get-bucket-versioning' "$AWS_LOG"
[[ "$(grep -c 'put-object' "$AWS_LOG")" -eq 2 ]]
grep -q -- '--if-none-match \\*' "$AWS_LOG"
grep -q -- '--server-side-encryption AES256' "$AWS_LOG"

: >"$AWS_LOG"
if FAKE_VERSIONING_STATUS=Suspended bash "$ROOT_DIR/scripts/release-aws-artifacts.sh" \
  --bucket automation-release-bucket \
  --release-id blocked \
  --runtime-zip "$WORK_DIR/runtime.zip" \
  --control-plane-zip "$WORK_DIR/control.zip" \
  --output "$WORK_DIR/blocked.json" >/dev/null 2>&1; then
  echo "release unexpectedly succeeded for a non-versioned bucket" >&2
  exit 1
fi
[[ "$(grep -c 'put-object' "$AWS_LOG" || true)" -eq 0 ]]
[[ ! -f "$WORK_DIR/blocked.json" ]]

printf 'release-aws-artifacts tests passed\n'
