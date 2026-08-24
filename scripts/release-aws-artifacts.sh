#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usage(){ echo 'Usage: release-aws-artifacts.sh --bucket BUCKET --release-id ID [--prefix PREFIX] [--region REGION] [--kms-key-id KEY] [--runtime-zip PATH] [--control-plane-zip PATH] [--web-zip PATH] [--output PATH]'; }
bucket=""; release_id=""; prefix="automation/releases"; region=""; kms_key_id=""; runtime_zip=""; control_plane_zip=""; web_zip=""; output=""
while (($#)); do case "$1" in --bucket) bucket="${2:-}";shift 2;; --release-id) release_id="${2:-}";shift 2;; --prefix) prefix="${2:-}";shift 2;; --region) region="${2:-}";shift 2;; --kms-key-id) kms_key_id="${2:-}";shift 2;; --runtime-zip) runtime_zip="${2:-}";shift 2;; --control-plane-zip) control_plane_zip="${2:-}";shift 2;; --web-zip) web_zip="${2:-}";shift 2;; --output) output="${2:-}";shift 2;; -h|--help) usage;exit 0;; *) echo "Unknown argument: $1" >&2;exit 2;; esac; done
[[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || { echo "valid --bucket is required" >&2; exit 2; }
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo "valid --release-id is required" >&2; exit 2; }
prefix="${prefix#/}"; prefix="${prefix%/}"; [[ -n "$prefix" && "$prefix" != *'..'* ]] || exit 2
command -v aws >/dev/null; command -v python3 >/dev/null; export AWS_PAGER=""
aws_args=(); [[ -z "$region" ]] || aws_args+=(--region "$region")
status="$(aws "${aws_args[@]}" s3api get-bucket-versioning --bucket "$bucket" --query Status --output text)"; [[ "$status" == Enabled ]] || { echo "release bucket must have S3 Versioning enabled" >&2; exit 3; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
[[ -n "$runtime_zip" ]] || { runtime_zip="$work/runtime.zip"; bash "$ROOT_DIR/scripts/package-agentcore-runtime.sh" "$runtime_zip"; }
[[ -n "$control_plane_zip" ]] || { control_plane_zip="$work/control.zip"; bash "$ROOT_DIR/scripts/package-control-plane-lambda.sh" "$control_plane_zip"; }
[[ -n "$web_zip" ]] || { web_zip="$work/web.zip"; bash "$ROOT_DIR/scripts/package-web-lambda.sh" "$web_zip" >/dev/null; }
python3 - "$runtime_zip" "$control_plane_zip" "$web_zip" <<'PY'
import sys,zipfile
req=[{"runtime-http.mjs","dist/index.js","package.json"},{"control-plane-lambda.mjs","capture-completion-lambda.mjs","dispatcher-lambda.mjs","dist/index.js","package.json"},{"run.sh"}]
for p,r in zip(sys.argv[1:],req):
  with zipfile.ZipFile(p) as z:
    names=set(z.namelist()); bad=z.testzip()
    if bad: raise SystemExit(f"corrupt zip member: {bad}")
    miss=r-names
    if miss: raise SystemExit(f"artifact {p} missing: {', '.join(sorted(miss))}")
    if p==sys.argv[3] and not ({"server.js","apps/web/server.js"}&names): raise SystemExit("web artifact missing server.js")
PY
sha(){ python3 - "$1" <<'PY'
import hashlib,sys
print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())
PY
}
upload(){ local p="$1" k="$2" s="$3" a="$4"; local enc=(--server-side-encryption AES256); [[ -z "$kms_key_id" ]] || enc=(--server-side-encryption aws:kms --ssekms-key-id "$kms_key_id"); aws "${aws_args[@]}" s3api put-object --bucket "$bucket" --key "$k" --body "$p" --if-none-match '*' "${enc[@]}" --metadata "sha256=$s,release-id=$release_id,artifact=$a" --query VersionId --output text; }
r_sha="$(sha "$runtime_zip")"; c_sha="$(sha "$control_plane_zip")"; w_sha="$(sha "$web_zip")"
r_key="$prefix/$release_id/agentcore-runtime.zip"; c_key="$prefix/$release_id/control-plane-lambda.zip"; w_key="$prefix/$release_id/web-lambda.zip"
r_ver="$(upload "$runtime_zip" "$r_key" "$r_sha" agentcore-runtime)"; c_ver="$(upload "$control_plane_zip" "$c_key" "$c_sha" control-plane-lambda)"; w_ver="$(upload "$web_zip" "$w_key" "$w_sha" web-lambda)"
for v in "$r_ver" "$c_ver" "$w_ver"; do [[ -n "$v" && "$v" != None && "$v" != null ]] || { echo "S3 did not return VersionId" >&2; exit 5; }; done
[[ -n "$output" ]] || output="$ROOT_DIR/dist/aws-release-$release_id.json"; mkdir -p "$(dirname "$output")"; tmp="$output.tmp"
BUCKET="$bucket" RELEASE_ID="$release_id" REGION="$region" R_KEY="$r_key" R_VER="$r_ver" R_SHA="$r_sha" C_KEY="$c_key" C_VER="$c_ver" C_SHA="$c_sha" W_KEY="$w_key" W_VER="$w_ver" W_SHA="$w_sha" python3 >"$tmp" <<'PY'
import json,os
b=os.environ['BUCKET']
print(json.dumps({'schemaVersion':1,'releaseId':os.environ['RELEASE_ID'],'region':os.environ['REGION'] or None,'bucket':b,'artifacts':{
'agentCoreRuntime':{'key':os.environ['R_KEY'],'versionId':os.environ['R_VER'],'sha256':os.environ['R_SHA']},
'controlPlaneLambda':{'key':os.environ['C_KEY'],'versionId':os.environ['C_VER'],'sha256':os.environ['C_SHA']},
'webLambda':{'key':os.environ['W_KEY'],'versionId':os.environ['W_VER'],'sha256':os.environ['W_SHA']}},'cloudFormationParameters':{
'agentCoreRuntime':{'RuntimeCodeBucket':b,'RuntimeCodePrefix':os.environ['R_KEY'],'RuntimeCodeVersionId':os.environ['R_VER']},
'controlPlaneService':{'CodeBucketName':b,'CodeObjectKey':os.environ['C_KEY'],'CodeObjectVersion':os.environ['C_VER']},
'webApp':{'WebCodeBucket':b,'WebCodeObjectKey':os.environ['W_KEY'],'WebCodeObjectVersion':os.environ['W_VER']}}},indent=2,sort_keys=True))
PY
mv "$tmp" "$output"; printf 'Release manifest: %s\n' "$output"
