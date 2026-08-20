#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ZIP="${1:-${ROOT_DIR}/dist/automation-control-plane.zip}"
BUILD_DIR="$(mktemp -d)"
DEPLOY_DIR="${BUILD_DIR}/package"
trap 'rm -rf "${BUILD_DIR}"' EXIT

cd "${ROOT_DIR}"
pnpm --filter @automation/contracts build
pnpm --filter @automation/core build
pnpm --filter @automation/aws build
pnpm --filter @automation/aws --prod deploy --legacy "${DEPLOY_DIR}"
cp packages/aws/control-plane-lambda.mjs "${DEPLOY_DIR}/control-plane-lambda.mjs"

test -f "${DEPLOY_DIR}/control-plane-lambda.mjs"
test -f "${DEPLOY_DIR}/dist/index.js"
test -f "${DEPLOY_DIR}/package.json"
test -d "${DEPLOY_DIR}/node_modules"

mkdir -p "$(dirname "${OUTPUT_ZIP}")"
python - "${DEPLOY_DIR}" "${OUTPUT_ZIP}" <<'PY'
from pathlib import Path
import sys
import zipfile

source = Path(sys.argv[1])
output = Path(sys.argv[2])
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(p for p in source.rglob("*") if p.is_file()):
        info = zipfile.ZipInfo(path.relative_to(source).as_posix())
        info.date_time = (1980, 1, 1, 0, 0, 0)
        info.external_attr = (0o644 & 0xFFFF) << 16
        archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
PY

printf 'Packaged control-plane Lambda: %s\n' "${OUTPUT_ZIP}"
