#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: deploy-aws-release.sh --manifest PATH --environment PATH [options]

Deploys an immutable Automation AWS release in dependency order. The release
manifest is authoritative for S3 object keys/VersionIds; environment-specific
CloudFormation parameters live in a separate JSON file.

Required:
  --manifest PATH
  --environment PATH
Optional:
  --output PATH
EOF
}
manifest=""; environment=""; output=""
while (($#)); do
  case "$1" in
    --manifest) manifest="${2:-}"; shift 2 ;;
    --environment) environment="${2:-}"; shift 2 ;;
    --output) output="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$manifest" && -f "$manifest" ]] || { echo "valid --manifest is required" >&2; exit 2; }
[[ -n "$environment" && -f "$environment" ]] || { echo "valid --environment is required" >&2; exit 2; }
command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
export AWS_PAGER=""

meta_file="$(mktemp)"; trap 'rm -f "$meta_file"' EXIT
python3 - "$manifest" "$environment" >"$meta_file" <<'PY'
import json, re, sys
from pathlib import Path
m=json.loads(Path(sys.argv[1]).read_text()); e=json.loads(Path(sys.argv[2]).read_text())
if m.get("schemaVersion") != 1: raise SystemExit("unsupported release manifest schemaVersion")
if e.get("schemaVersion") != 1: raise SystemExit("unsupported environment schemaVersion")
r=m.get("releaseId"); region=e.get("region"); prefix=e.get("stackPrefix")
if not isinstance(r,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}",r): raise SystemExit("invalid releaseId in manifest")
if not isinstance(region,str) or not re.fullmatch(r"[a-z]{2}(?:-gov)?-[a-z]+-\d",region): raise SystemExit("invalid deployment region")
if m.get("region") not in (None,"",region): raise SystemExit("release region does not match deployment region")
if not isinstance(prefix,str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,79}",prefix): raise SystemExit("invalid stackPrefix")
arts=m.get("artifacts"); cf=m.get("cloudFormationParameters")
if not isinstance(arts,dict) or not isinstance(cf,dict): raise SystemExit("release manifest is missing artifacts/cloudFormationParameters")
for name in ("agentCoreRuntime","controlPlaneLambda"):
    item=arts.get(name)
    if not isinstance(item,dict): raise SystemExit(f"missing release artifact: {name}")
    for key in ("key","versionId","sha256"):
        if not isinstance(item.get(key),str) or not item[key]: raise SystemExit(f"invalid {name}.{key}")
    if not re.fullmatch(r"[0-9a-f]{64}",item["sha256"]): raise SystemExit(f"invalid {name}.sha256")
for name in ("agentCoreRuntime","controlPlaneService"):
    values=cf.get(name)
    if not isinstance(values,dict) or not values: raise SystemExit(f"missing cloudFormationParameters.{name}")
params=e.get("parameters")
if not isinstance(params,dict): raise SystemExit("environment parameters must be an object")
for section in ("auth","runtime","scheduling","controlPlaneService"):
    if not isinstance(params.get(section),dict): raise SystemExit(f"environment parameters.{section} must be an object")
if "observability" in params and not isinstance(params["observability"],dict): raise SystemExit("environment parameters.observability must be an object when provided")
reserved={
 "auth":{"ControlPlaneLambdaArn"},
 "runtime":{"RuntimeCodeBucket","RuntimeCodePrefix","RuntimeCodeVersionId","CognitoUserPoolId"},
 "scheduling":{"AgentRuntimeArn","DispatcherCodeBucket","DispatcherCodeObjectKey","DispatcherCodeObjectVersion","DispatcherFunctionArn","DispatcherFunctionRoleName"},
 "controlPlaneService":{"CodeBucketName","CodeObjectKey","CodeObjectVersion","CognitoIssuer","CognitoAppClientId","AgentCoreRuntimeArn","ScheduleDispatchQueueArn","ScheduleDispatchDlqArn","SchedulerTargetRoleArn","SchedulerGroupName","ScheduledRunStateMachineArn"},
 "observability":{"WorkerFunctionRoleName","DispatchDeadLetterQueueName"},
}
for section,values in params.items():
    conflicts=sorted(reserved.get(section,set()).intersection(values))
    if conflicts: raise SystemExit(f"parameters.{section} cannot override derived parameters: {', '.join(conflicts)}")
    for key,value in values.items():
        if not isinstance(key,str) or not key or not key.replace("_","").isalnum(): raise SystemExit(f"invalid parameter name in {section}: {key!r}")
        if not isinstance(value,(str,int,float,bool)): raise SystemExit(f"parameter {section}.{key} must be scalar")
        if any(c in str(value) for c in ("\n","\r","\x00")): raise SystemExit(f"parameter {section}.{key} contains unsupported control characters")
print(f"RELEASE_ID={r}"); print(f"REGION={region}"); print(f"STACK_PREFIX={prefix}")
PY
release_id=""; region=""; stack_prefix=""
while IFS='=' read -r key value; do case "$key" in RELEASE_ID) release_id="$value";; REGION) region="$value";; STACK_PREFIX) stack_prefix="$value";; esac; done <"$meta_file"
[[ -n "$release_id" && -n "$region" && -n "$stack_prefix" ]] || exit 2
aws_args=(--region "$region")
auth_stack="$stack_prefix-auth"; runtime_stack="$stack_prefix-runtime"; scheduling_stack="$stack_prefix-scheduling"; service_stack="$stack_prefix-control-plane"; observability_stack="$stack_prefix-observability"

load_params(){ python3 - "$environment" "$1" <<'PY'
import json,sys
from pathlib import Path
p=json.loads(Path(sys.argv[1]).read_text())["parameters"].get(sys.argv[2],{})
for k in sorted(p):
 v=p[k]; print(f"{k}={'true' if v is True else 'false' if v is False else v}")
PY
}
manifest_params(){ python3 - "$manifest" "$1" <<'PY'
import json,sys
from pathlib import Path
p=json.loads(Path(sys.argv[1]).read_text())["cloudFormationParameters"][sys.argv[2]]
for k,v in sorted(p.items()): print(f"{k}={v}")
PY
}
dispatcher_manifest_params(){ python3 - "$manifest" <<'PY'
import json,sys
from pathlib import Path
p=json.loads(Path(sys.argv[1]).read_text())["cloudFormationParameters"]["controlPlaneService"]
print(f"DispatcherCodeBucket={p['CodeBucketName']}")
print(f"DispatcherCodeObjectKey={p['CodeObjectKey']}")
print(f"DispatcherCodeObjectVersion={p['CodeObjectVersion']}")
PY
}
cf_deploy(){ local stack="$1" template="$2"; shift 2; aws "${aws_args[@]}" cloudformation deploy --stack-name "$stack" --template-file "$ROOT_DIR/$template" --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --tags managedBy=automation-platform "releaseId=$release_id" --parameter-overrides "$@"; }
stack_output(){ local value; value="$(aws "${aws_args[@]}" cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text)"; [[ -n "$value" && "$value" != None && "$value" != null ]] || { echo "missing CloudFormation output $2 from $1" >&2; exit 6; }; printf '%s' "$value"; }

mapfile -t auth_params < <(load_params auth)
cf_deploy "$auth_stack" infra/aws/control-plane-auth.yaml "${auth_params[@]}"
cognito_issuer="$(stack_output "$auth_stack" CognitoIssuer)"; cognito_client_id="$(stack_output "$auth_stack" CognitoAppClientId)"; cognito_user_pool_id="$(stack_output "$auth_stack" CognitoUserPoolId)"
mapfile -t runtime_env < <(load_params runtime); mapfile -t runtime_release < <(manifest_params agentCoreRuntime)
cf_deploy "$runtime_stack" infra/aws/agentcore-runtime.yaml "${runtime_env[@]}" "${runtime_release[@]}" "CognitoUserPoolId=$cognito_user_pool_id"
agent_runtime_arn="$(stack_output "$runtime_stack" AgentRuntimeArn)"; runtime_role_arn="$(stack_output "$runtime_stack" AgentRuntimeExecutionRoleArn)"
mapfile -t scheduling_params < <(load_params scheduling); mapfile -t dispatcher_release < <(dispatcher_manifest_params)
cf_deploy "$scheduling_stack" infra/aws/scheduling-dispatch.yaml "${scheduling_params[@]}" "${dispatcher_release[@]}" "AgentRuntimeArn=$agent_runtime_arn"
dispatch_queue_arn="$(stack_output "$scheduling_stack" DispatchQueueArn)"; dispatch_dlq_arn="$(stack_output "$scheduling_stack" DispatchDeadLetterQueueArn)"; scheduler_role_arn="$(stack_output "$scheduling_stack" SchedulerTargetRoleArn)"; scheduler_group_name="$(stack_output "$scheduling_stack" SchedulerGroupName)"; state_machine_arn="$(stack_output "$scheduling_stack" ScheduledRunStateMachineArn)"
mapfile -t service_env < <(load_params controlPlaneService); mapfile -t service_release < <(manifest_params controlPlaneService)
cf_deploy "$service_stack" infra/aws/control-plane-service.yaml "${service_env[@]}" "${service_release[@]}" "CognitoIssuer=$cognito_issuer" "CognitoAppClientId=$cognito_client_id" "AgentCoreRuntimeArn=$agent_runtime_arn" "ScheduleDispatchQueueArn=$dispatch_queue_arn" "ScheduleDispatchDlqArn=$dispatch_dlq_arn" "SchedulerTargetRoleArn=$scheduler_role_arn" "SchedulerGroupName=$scheduler_group_name" "ScheduledRunStateMachineArn=$state_machine_arn"
control_plane_lambda_arn="$(stack_output "$service_stack" ControlPlaneLambdaArn)"; capture_endpoint="$(stack_output "$service_stack" CaptureCompletionApiEndpoint)"; capture_invoke_arn="$(stack_output "$service_stack" CaptureCompletionInvokeArn)"
cf_deploy "$auth_stack" infra/aws/control-plane-auth.yaml "${auth_params[@]}" "ControlPlaneLambdaArn=$control_plane_lambda_arn"
control_plane_url="$(stack_output "$auth_stack" ControlPlaneUrl)"; cognito_domain="$(stack_output "$auth_stack" CognitoDomain)"
observability_deployed=false
has_observability="$(python3 - "$environment" <<'PY'
import json,sys
from pathlib import Path
p=json.loads(Path(sys.argv[1]).read_text()).get("parameters",{}).get("observability")
print("yes" if isinstance(p,dict) and p else "no")
PY
)"
if [[ "$has_observability" == yes ]]; then
  runtime_role_name="${runtime_role_arn##*/}"; dispatch_dlq_name="${dispatch_dlq_arn##*:}"; mapfile -t observability_params < <(load_params observability)
  cf_deploy "$observability_stack" infra/aws/observability-notifications.yaml "${observability_params[@]}" "WorkerFunctionRoleName=$runtime_role_name" "DispatchDeadLetterQueueName=$dispatch_dlq_name"; observability_deployed=true
fi
[[ -n "$output" ]] || output="$ROOT_DIR/dist/aws-deployment-$release_id.json"; mkdir -p "$(dirname "$output")"; tmp_output="$output.tmp"
RELEASE_ID="$release_id" REGION="$region" STACK_PREFIX="$stack_prefix" AUTH_STACK="$auth_stack" RUNTIME_STACK="$runtime_stack" SCHEDULING_STACK="$scheduling_stack" SERVICE_STACK="$service_stack" OBS_STACK="$observability_stack" OBS_DEPLOYED="$observability_deployed" CONTROL_PLANE_URL="$control_plane_url" COGNITO_DOMAIN="$cognito_domain" AGENT_RUNTIME_ARN="$agent_runtime_arn" CAPTURE_ENDPOINT="$capture_endpoint" CAPTURE_INVOKE_ARN="$capture_invoke_arn" python3 >"$tmp_output" <<'PY'
import json,os
print(json.dumps({"schemaVersion":1,"releaseId":os.environ["RELEASE_ID"],"region":os.environ["REGION"],"stackPrefix":os.environ["STACK_PREFIX"],"stacks":{"auth":os.environ["AUTH_STACK"],"agentCoreRuntime":os.environ["RUNTIME_STACK"],"scheduling":os.environ["SCHEDULING_STACK"],"controlPlaneService":os.environ["SERVICE_STACK"],"observability":os.environ["OBS_STACK"] if os.environ["OBS_DEPLOYED"]=="true" else None},"outputs":{"controlPlaneUrl":os.environ["CONTROL_PLANE_URL"],"cognitoDomain":os.environ["COGNITO_DOMAIN"],"agentRuntimeArn":os.environ["AGENT_RUNTIME_ARN"],"captureCompletionApiEndpoint":os.environ["CAPTURE_ENDPOINT"],"captureCompletionInvokeArn":os.environ["CAPTURE_INVOKE_ARN"]}},indent=2,sort_keys=True))
PY
mv "$tmp_output" "$output"; printf 'Deployment result: %s\n' "$output"
