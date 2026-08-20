#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${1:-${ROOT_DIR}/.agentcore-runtime/automation-runtime.zip}"
WORK_DIR="$(mktemp -d)"
DEPLOY_DIR="${WORK_DIR}/runtime"
trap 'rm -rf "${WORK_DIR}"' EXIT

cd "${ROOT_DIR}"

pnpm --filter @automation/contracts build
pnpm --filter @automation/core build
pnpm --filter @automation/aws build
pnpm --filter @automation/aws --prod deploy --legacy "${DEPLOY_DIR}"

cp "${ROOT_DIR}/packages/aws/runtime-http.mjs" "${DEPLOY_DIR}/runtime-http.mjs"
test -f "${DEPLOY_DIR}/dist/index.js"
test -d "${DEPLOY_DIR}/node_modules"

mkdir -p "$(dirname "${OUTPUT_PATH}")"
rm -f "${OUTPUT_PATH}"
DEPLOY_DIR="${DEPLOY_DIR}" OUTPUT_PATH="${OUTPUT_PATH}" python3 <<'PY'
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(os.environ["DEPLOY_DIR"])
out = Path(os.environ["OUTPUT_PATH"])
with ZipFile(out, "w", compression=ZIP_DEFLATED) as archive:
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        archive.write(path, path.relative_to(root))
PY

python3 - "${OUTPUT_PATH}" <<'PY'
import sys
from zipfile import ZipFile

with ZipFile(sys.argv[1]) as archive:
    names = set(archive.namelist())
    required = {"runtime-http.mjs", "dist/index.js", "package.json"}
    missing = sorted(required - names)
    if missing:
        raise SystemExit("runtime package missing required files: " + ", ".join(missing))
print(sys.argv[1])
PY
