#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: release-aws-artifacts.sh --bucket BUCKET --release-id ID [options]

Packages (unless prebuilt ZIPs are supplied), validates, and uploads the AgentCore
Runtime and control-plane Lambda as create-only objects in a versioned S3 bucket.
A manifest containing exact object VersionIds and CloudFormation parameters is
written only after both uploads succeed.

Required:
  --bucket BUCKET                 Versioned S3 release bucket
  --release-id ID                 Unique release identifier (for example a git SHA)

Optional:
  --prefix PREFIX                 S3 prefix (default: automation/releases)
  --region REGION                 AWS region passed to the AWS CLI
  --kms-key-id KEY                KMS key for artifact encryption; otherwise AES256
  --runtime-zip PATH              Use a prebuilt AgentCore Runtime ZIP
  --control-plane-zip PATH        Use a prebuilt control-plane Lambda ZIP
  --output PATH                   Manifest path (default: dist/aws-release-<ID>.json)
  -h, --help                      Show this help

Credentials are intentionally not accepted by this script. The AWS CLI uses its
standard credential provider chain (for CI, prefer short-lived OIDC credentials).
EOF
}

bucket=""
release_id=""
prefix="automation/releases"
region=""
kms_key_id=""
runtime_zip=""
control_plane_zip=""
output=""

while (($#)); do
  case "$1" in
    --bucket) bucket="${2:-}"; shift 2 ;;
    --release-id) release_id="${2:-}"; shift 2 ;;
    --prefix) prefix="${2:-}"; shift 2 ;;
    --region) region="${2:-}"; shift 2 ;;
    --kms-key-id) kms_key_id="${2:-}"; shift 2 ;;
    --runtime-zip) runtime_zip="${2:-}"; shift 2 ;;
    --control-plane-zip) control_plane_zip="${2:-}"; shift 2 ;;
    --output) output="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$bucket" ]] || { echo "--bucket is required" >&2; exit 2; }
[[ -n "$release_id" ]] || { echo "--release-id is required" >&2; exit 2; }
[[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || { echo "invalid S3 bucket name" >&2; exit 2; }
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo "invalid release id" >&2; exit 2; }

prefix="${prefix#/}"
prefix="${prefix%/}"
[[ -n "$prefix" ]] || { echo "release prefix must not be empty" >&2; exit 2; }
[[ "$prefix" != *".."* ]] || { echo "release prefix must not contain '..'" >&2; exit 2; }

command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }

aws_args=()
if [[ -n "$region" ]]; then
  aws_args+=(--region "$region")
fi
export AWS_PAGER=""

versioning_status="$(aws "${aws_args[@]}" s3api get-bucket-versioning --bucket "$bucket" --query Status --output text)"
if [[ "$versioning_status" != "Enabled" ]]; then
  echo "release bucket must have S3 Versioning enabled; got '${versioning_status:-unset}'" >&2
  exit 3
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

if [[ -z "$runtime_zip" ]]; then
  runtime_zip="$work_dir/automation-agentcore-runtime.zip"
  bash "$ROOT_DIR/scripts/package-agentcore-runtime.sh" "$runtime_zip"
fi
if [[ -z "$control_plane_zip" ]]; then
  control_plane_zip="$work_dir/automation-control-plane.zip"
  bash "$ROOT_DIR/scripts/package-control-plane-lambda.sh" "$control_plane_zip"
fi

validate_zip() {
  local path="$1"
  shift
  [[ -f "$path" ]] || { echo "artifact not found: $path" >&2; exit 4; }
  python3 - "$path" "$@" <<'PY'
import sys
import zipfile

path = sys.argv[1]
required = set(sys.argv[2:])
try:
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        bad = archive.testzip()
except (OSError, zipfile.BadZipFile) as exc:
    raise SystemExit(f"invalid zip {path}: {exc}")
if bad:
    raise SystemExit(f"corrupt zip member in {path}: {bad}")
missing = sorted(required - names)
if missing:
    raise SystemExit(f"artifact {path} missing required entries: {', '.join(missing)}")
PY
}

validate_zip "$runtime_zip" runtime-http.mjs dist/index.js package.json
validate_zip "$control_plane_zip" control-plane-lambda.mjs capture-completion-lambda.mjs dist/index.js package.json

sha256_file() {
  python3 - "$1" <<'PY'
import hashlib
import sys
from pathlib import Path
print(hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest())
PY
}

runtime_sha="$(sha256_file "$runtime_zip")"
control_plane_sha="$(sha256_file "$control_plane_zip")"
runtime_key="$prefix/$release_id/agentcore-runtime.zip"
control_plane_key="$prefix/$release_id/control-plane-lambda.zip"

upload_versioned() {
  local path="$1"
  local key="$2"
  local sha="$3"
  local artifact="$4"
  local encryption_args=(--server-side-encryption AES256)
  if [[ -n "$kms_key_id" ]]; then
    encryption_args=(--server-side-encryption aws:kms --ssekms-key-id "$kms_key_id")
  fi

  local version_id
  version_id="$(aws "${aws_args[@]}" s3api put-object \
    --bucket "$bucket" \
    --key "$key" \
    --body "$path" \
    --if-none-match '*' \
    "${encryption_args[@]}" \
    --metadata "sha256=$sha,release-id=$release_id,artifact=$artifact" \
    --query VersionId \
    --output text)"

  if [[ -z "$version_id" || "$version_id" == "None" || "$version_id" == "null" ]]; then
    echo "S3 did not return an immutable VersionId for $key" >&2
    exit 5
  fi
  printf '%s' "$version_id"
}

runtime_version="$(upload_versioned "$runtime_zip" "$runtime_key" "$runtime_sha" agentcore-runtime)"
control_plane_version="$(upload_versioned "$control_plane_zip" "$control_plane_key" "$control_plane_sha" control-plane-lambda)"

if [[ -z "$output" ]]; then
  output="$ROOT_DIR/dist/aws-release-$release_id.json"
fi
mkdir -p "$(dirname "$output")"
manifest_tmp="$output.tmp"

BUCKET="$bucket" RELEASE_ID="$release_id" REGION="$region" \
RUNTIME_KEY="$runtime_key" RUNTIME_VERSION="$runtime_version" RUNTIME_SHA="$runtime_sha" \
CONTROL_KEY="$control_plane_key" CONTROL_VERSION="$control_plane_version" CONTROL_SHA="$control_plane_sha" \
python3 >"$manifest_tmp" <<'PY'
import json
import os

manifest = {
    "schemaVersion": 1,
    "releaseId": os.environ["RELEASE_ID"],
    "region": os.environ["REGION"] or None,
    "bucket": os.environ["BUCKET"],
    "artifacts": {
        "agentCoreRuntime": {
            "key": os.environ["RUNTIME_KEY"],
            "versionId": os.environ["RUNTIME_VERSION"],
            "sha256": os.environ["RUNTIME_SHA"],
        },
        "controlPlaneLambda": {
            "key": os.environ["CONTROL_KEY"],
            "versionId": os.environ["CONTROL_VERSION"],
            "sha256": os.environ["CONTROL_SHA"],
        },
    },
    "cloudFormationParameters": {
        "agentCoreRuntime": {
            "RuntimeCodeBucket": os.environ["BUCKET"],
            "RuntimeCodePrefix": os.environ["RUNTIME_KEY"],
            "RuntimeCodeVersionId": os.environ["RUNTIME_VERSION"],
        },
        "controlPlaneService": {
            "CodeBucketName": os.environ["BUCKET"],
            "CodeObjectKey": os.environ["CONTROL_KEY"],
            "CodeObjectVersion": os.environ["CONTROL_VERSION"],
        },
    },
}
print(json.dumps(manifest, indent=2, sort_keys=True))
PY
mv "$manifest_tmp" "$output"

printf 'Release manifest: %s\n' "$output"
printf 'AgentCore Runtime: s3://%s/%s?versionId=%s\n' "$bucket" "$runtime_key" "$runtime_version"
printf 'Control plane: s3://%s/%s?versionId=%s\n' "$bucket" "$control_plane_key" "$control_plane_version"
