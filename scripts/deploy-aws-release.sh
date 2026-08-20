#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: deploy-aws-release.sh --manifest PATH --environment PATH [options]

Deploys an immutable Automation AWS release in dependency order. The release
manifest is produced by release-aws-artifacts.sh and remains the authority for
S3 object keys/VersionIds. Environment-specific CloudFormation parameters live
in a separate JSON file and are never copied into the release manifest.

Required:
  --manifest PATH       Immutable release manifest
  --environment PATH    Environment deployment JSON

Optional:
  --output PATH         Deployment result JSON (default: dist/aws-deployment-<release>.json)
  -h, --help            Show this help

Environment JSON schema (schemaVersion 1):
{
  "schemaVersion": 1,
  "region": "ap-south-1",
  "stackPrefix": "automation-dev",
  "parameters": {
    "auth": { "WebCallbackUrl": "...", "WebLogoutUrl": "...", "UserPoolDomainPrefix": "..." },
    "runtime": { ... },
    "scheduling": { ... },
    "controlPlaneService": { ... },
    "observability": { ... } // optional
  }
}

Derived parameters (artifact VersionIds and cross-stack outputs) are reserved
and cannot be overridden by the environment file. Credentials are intentionally
not accepted; the AWS CLI must use its standard credential provider chain.
EOF
}

manifest=""
environment=""
output=""
while (($#)); do
  case "$1" in
    --manifest) manifest="${2:-}"; shift 2 ;;
    --environment) environment="${2:-}"; shift 2 ;;
    --output) output="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$manifest" ]] || { echo "--manifest is required" >&2; exit 2; }
[[ -n "$environment" ]] || { echo "--environment is required" >&2; exit 2; }
[[ -f "$manifest" ]] || { echo "release manifest not found: $manifest" >&2; exit 2; }
[[ -f "$environment" ]] || { echo "environment file not found: $environment" >&2; exit 2; }
command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
export AWS_PAGER=""

meta_file="$(mktemp)"
trap 'rm -f "$meta_file"' EXIT
python3 - "$manifest" "$environment" >"$meta_file" <<'PY'
import json
import re
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
env = json.loads(Path(sys.argv[2]).read_text())
if manifest.get("schemaVersion") != 1:
    raise SystemExit("unsupported release manifest schemaVersion")
if env.get("schemaVersion") != 1:
    raise SystemExit("unsupported environment schemaVersion")
release_id = manifest.get("releaseId")
region = env.get("region")
prefix = env.get("stackPrefix")
if not isinstance(release_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", release_id):
    raise SystemExit("invalid releaseId in manifest")
if not isinstance(region, str) or not re.fullmatch(r"[a-z]{2}(?:-gov)?-[a-z]+-\d", region):
    raise SystemExit("invalid deployment region")
manifest_region = manifest.get("region")
if manifest_region not in (None, "", region):
    raise SystemExit(f"release region {manifest_region!r} does not match deployment region {region!r}")
if not isinstance(prefix, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,79}", prefix):
    raise SystemExit("invalid stackPrefix")

artifacts = manifest.get("artifacts")
cf = manifest.get("cloudFormationParameters")
if not isinstance(artifacts, dict) or not isinstance(cf, dict):
    raise SystemExit("release manifest is missing artifacts/cloudFormationParameters")
for name in ("agentCoreRuntime", "controlPlaneLambda"):
    item = artifacts.get(name)
    if not isinstance(item, dict):
        raise SystemExit(f"missing release artifact: {name}")
    for key in ("key", "versionId", "sha256"):
        if not isinstance(item.get(key), str) or not item[key]:
            raise SystemExit(f"invalid {name}.{key}")
    if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
        raise SystemExit(f"invalid {name}.sha256")
for name in ("agentCoreRuntime", "controlPlaneService"):
    values = cf.get(name)
    if not isinstance(values, dict) or not values:
        raise SystemExit(f"missing cloudFormationParameters.{name}")
    for key, value in values.items():
        if not isinstance(key, str) or not isinstance(value, str) or not value:
            raise SystemExit(f"invalid cloudFormationParameters.{name}")

params = env.get("parameters")
if not isinstance(params, dict):
    raise SystemExit("environment parameters must be an object")
required = ("auth", "runtime", "scheduling", "controlPlaneService")
for section in required:
    if not isinstance(params.get(section), dict):
        raise SystemExit(f"environment parameters.{section} must be an object")
if "observability" in params and not isinstance(params["observability"], dict):
    raise SystemExit("environment parameters.observability must be an object when provided")

reserved = {
    "auth": {"ControlPlaneLambdaArn"},
    "runtime": {"RuntimeCodeBucket", "RuntimeCodePrefix", "RuntimeCodeVersionId", "CognitoUserPoolId"},
    "scheduling": {"AgentRuntimeArn"},
    "controlPlaneService": {
        "CodeBucketName", "CodeObjectKey", "CodeObjectVersion", "CognitoIssuer", "CognitoAppClientId",
        "AgentCoreRuntimeArn", "ScheduleDispatchQueueArn", "ScheduleDispatchDlqArn", "SchedulerTargetRoleArn",
        "SchedulerGroupName", "ScheduledRunStateMachineArn",
    },
    "observability": {"WorkerFunctionRoleName", "DispatchDeadLetterQueueName"},
}
for section, values in params.items():
    if not isinstance(values, dict):
        raise SystemExit(f"environment parameters.{section} must be an object")
    conflicts = sorted(reserved.get(section, set()).intersection(values))
    if conflicts:
        raise SystemExit(f"parameters.{section} cannot override derived parameters: {', '.join(conflicts)}")
    for key, value in values.items():
        if not isinstance(key, str) or not key or not key.replace("_", "").isalnum():
            raise SystemExit(f"invalid parameter name in {section}: {key!r}")
        if not isinstance(value, (str, int, float, bool)):
            raise SystemExit(f"parameter {section}.{key} must be a string/number/boolean")
        rendered = str(value)
        if "\n" in rendered or "\r" in rendered or "\x00" in rendered:
            raise SystemExit(f"parameter {section}.{key} contains unsupported control characters")

print(f"RELEASE_ID={release_id}")
print(f"REGION={region}")
print(f"STACK_PREFIX={prefix}")
PY

release_id=""
region=""
stack_prefix=""
while IFS='=' read -r key value; do
  case "$key" in
    RELEASE_ID) release_id="$value" ;;
    REGION) region="$value" ;;
    STACK_PREFIX) stack_prefix="$value" ;;
  esac
done <"$meta_file"
[[ -n "$release_id" && -n "$region" && -n "$stack_prefix" ]] || { echo "failed to parse deployment metadata" >&2; exit 2; }

aws_args=(--region "$region")
auth_stack="$stack_prefix-auth"
runtime_stack="$stack_prefix-runtime"
scheduling_stack="$stack_prefix-scheduling"
service_stack="$stack_prefix-control-plane"
observability_stack="$stack_prefix-observability"

load_params() {
  local section="$1"
  python3 - "$environment" "$section" <<'PY'
import json
import sys
from pathlib import Path

env = json.loads(Path(sys.argv[1]).read_text())
params = env["parameters"].get(sys.argv[2], {})
for key in sorted(params):
    value = params[key]
    if isinstance(value, bool):
        value = "true" if value else "false"
    else:
        value = str(value)
    print(f"{key}={value}")
PY
}

manifest_params() {
  local section="$1"
  python3 - "$manifest" "$section" <<'PY'
import json
import sys
from pathlib import Path
m = json.loads(Path(sys.argv[1]).read_text())
for key, value in sorted(m["cloudFormationParameters"][sys.argv[2]].items()):
    print(f"{key}={value}")
PY
}

cf_deploy() {
  local stack="$1"
  local template="$2"
  shift 2
  local params=("$@")
  aws "${aws_args[@]}" cloudformation deploy \
    --stack-name "$stack" \
    --template-file "$ROOT_DIR/$template" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --tags managedBy=automation-platform "releaseId=$release_id" \
    --parameter-overrides "${params[@]}"
}

stack_output() {
  local stack="$1"
  local key="$2"
  local value
  value="$(aws "${aws_args[@]}" cloudformation describe-stacks \
    --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue | [0]" \
    --output text)"
  if [[ -z "$value" || "$value" == "None" || "$value" == "null" ]]; then
    echo "missing CloudFormation output $key from $stack" >&2
    exit 6
  fi
  printf '%s' "$value"
}

# Phase 1 establishes Cognito and the stable API resource without exposing a
# route until the Lambda exists. The template conditionally omits integration,
# route, and invoke permission while ControlPlaneLambdaArn is empty.
mapfile -t auth_params < <(load_params auth)
cf_deploy "$auth_stack" infra/aws/control-plane-auth.yaml "${auth_params[@]}"
cognito_issuer="$(stack_output "$auth_stack" CognitoIssuer)"
cognito_client_id="$(stack_output "$auth_stack" CognitoAppClientId)"
cognito_user_pool_id="$(stack_output "$auth_stack" CognitoUserPoolId)"

mapfile -t runtime_env < <(load_params runtime)
mapfile -t runtime_release < <(manifest_params agentCoreRuntime)
cf_deploy "$runtime_stack" infra/aws/agentcore-runtime.yaml \
  "${runtime_env[@]}" "${runtime_release[@]}" "CognitoUserPoolId=$cognito_user_pool_id"
agent_runtime_arn="$(stack_output "$runtime_stack" AgentRuntimeArn)"
runtime_role_arn="$(stack_output "$runtime_stack" AgentRuntimeExecutionRoleArn)"

mapfile -t scheduling_params < <(load_params scheduling)
cf_deploy "$scheduling_stack" infra/aws/scheduling-dispatch.yaml \
  "${scheduling_params[@]}" "AgentRuntimeArn=$agent_runtime_arn"
dispatch_queue_arn="$(stack_output "$scheduling_stack" DispatchQueueArn)"
dispatch_dlq_arn="$(stack_output "$scheduling_stack" DispatchDeadLetterQueueArn)"
scheduler_role_arn="$(stack_output "$scheduling_stack" SchedulerTargetRoleArn)"
scheduler_group_name="$(stack_output "$scheduling_stack" SchedulerGroupName)"
state_machine_arn="$(stack_output "$scheduling_stack" ScheduledRunStateMachineArn)"

mapfile -t service_env < <(load_params controlPlaneService)
mapfile -t service_release < <(manifest_params controlPlaneService)
cf_deploy "$service_stack" infra/aws/control-plane-service.yaml \
  "${service_env[@]}" "${service_release[@]}" \
  "CognitoIssuer=$cognito_issuer" "CognitoAppClientId=$cognito_client_id" \
  "AgentCoreRuntimeArn=$agent_runtime_arn" \
  "ScheduleDispatchQueueArn=$dispatch_queue_arn" "ScheduleDispatchDlqArn=$dispatch_dlq_arn" \
  "SchedulerTargetRoleArn=$scheduler_role_arn" "SchedulerGroupName=$scheduler_group_name" \
  "ScheduledRunStateMachineArn=$state_machine_arn"
control_plane_lambda_arn="$(stack_output "$service_stack" ControlPlaneLambdaArn)"
capture_endpoint="$(stack_output "$service_stack" CaptureCompletionApiEndpoint)"
capture_invoke_arn="$(stack_output "$service_stack" CaptureCompletionInvokeArn)"

# Phase 2 attaches the JWT API only after the control-plane Lambda exists,
# removing the previous auth <-> service CloudFormation dependency cycle.
cf_deploy "$auth_stack" infra/aws/control-plane-auth.yaml \
  "${auth_params[@]}" "ControlPlaneLambdaArn=$control_plane_lambda_arn"
control_plane_url="$(stack_output "$auth_stack" ControlPlaneUrl)"
cognito_domain="$(stack_output "$auth_stack" CognitoDomain)"

observability_deployed=false
has_observability="$(python3 - "$environment" <<'PY'
import json, sys
from pathlib import Path
p = json.loads(Path(sys.argv[1]).read_text()).get("parameters", {}).get("observability")
print("yes" if isinstance(p, dict) and p else "no")
PY
)"
if [[ "$has_observability" == "yes" ]]; then
  runtime_role_name="${runtime_role_arn##*/}"
  dispatch_dlq_name="${dispatch_dlq_arn##*:}"
  mapfile -t observability_params < <(load_params observability)
  cf_deploy "$observability_stack" infra/aws/observability-notifications.yaml \
    "${observability_params[@]}" "WorkerFunctionRoleName=$runtime_role_name" "DispatchDeadLetterQueueName=$dispatch_dlq_name"
  observability_deployed=true
fi

if [[ -z "$output" ]]; then
  output="$ROOT_DIR/dist/aws-deployment-$release_id.json"
fi
mkdir -p "$(dirname "$output")"
tmp_output="$output.tmp"
RELEASE_ID="$release_id" REGION="$region" STACK_PREFIX="$stack_prefix" \
AUTH_STACK="$auth_stack" RUNTIME_STACK="$runtime_stack" SCHEDULING_STACK="$scheduling_stack" SERVICE_STACK="$service_stack" \
OBS_STACK="$observability_stack" OBS_DEPLOYED="$observability_deployed" \
CONTROL_PLANE_URL="$control_plane_url" COGNITO_DOMAIN="$cognito_domain" AGENT_RUNTIME_ARN="$agent_runtime_arn" \
CAPTURE_ENDPOINT="$capture_endpoint" CAPTURE_INVOKE_ARN="$capture_invoke_arn" \
python3 >"$tmp_output" <<'PY'
import json
import os
print(json.dumps({
    "schemaVersion": 1,
    "releaseId": os.environ["RELEASE_ID"],
    "region": os.environ["REGION"],
    "stackPrefix": os.environ["STACK_PREFIX"],
    "stacks": {
        "auth": os.environ["AUTH_STACK"],
        "agentCoreRuntime": os.environ["RUNTIME_STACK"],
        "scheduling": os.environ["SCHEDULING_STACK"],
        "controlPlaneService": os.environ["SERVICE_STACK"],
        "observability": os.environ["OBS_STACK"] if os.environ["OBS_DEPLOYED"] == "true" else None,
    },
    "outputs": {
        "controlPlaneUrl": os.environ["CONTROL_PLANE_URL"],
        "cognitoDomain": os.environ["COGNITO_DOMAIN"],
        "agentRuntimeArn": os.environ["AGENT_RUNTIME_ARN"],
        "captureCompletionApiEndpoint": os.environ["CAPTURE_ENDPOINT"],
        "captureCompletionInvokeArn": os.environ["CAPTURE_INVOKE_ARN"],
    },
}, indent=2, sort_keys=True))
PY
mv "$tmp_output" "$output"
printf 'Deployment result: %s\n' "$output"
