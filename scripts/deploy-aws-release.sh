#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest=""
environment=""
output=""

while (($#)); do
  case "$1" in
    --manifest)
      manifest="${2:-}"
      shift 2
      ;;
    --environment)
      environment="${2:-}"
      shift 2
      ;;
    --output)
      output="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo 'Usage: deploy-aws-release.sh --manifest PATH --environment PATH [--output PATH]'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

[[ -f "$manifest" && -f "$environment" ]] || {
  echo "valid --manifest and --environment are required" >&2
  exit 2
}
command -v aws >/dev/null || exit 2
command -v python3 >/dev/null || exit 2
export AWS_PAGER=""

meta="$(mktemp)"
browser_state="$(mktemp)"
trap 'rm -f "$meta" "$browser_state"' EXIT

python3 - "$manifest" "$environment" >"$meta" <<'PY'
import json
import re
import sys
from pathlib import Path

m = json.loads(Path(sys.argv[1]).read_text())
e = json.loads(Path(sys.argv[2]).read_text())
if m.get('schemaVersion') != 1 or e.get('schemaVersion') != 1:
    raise SystemExit('unsupported schemaVersion')

release_id = m.get('releaseId')
region = e.get('region')
prefix = e.get('stackPrefix')
if not isinstance(release_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', release_id):
    raise SystemExit('invalid releaseId')
if not isinstance(region, str) or not re.fullmatch(r'[a-z]{2}(?:-gov)?-[a-z]+-\d', region):
    raise SystemExit('invalid region')
if m.get('region') not in (None, '', region):
    raise SystemExit('release region mismatch')
if not isinstance(prefix, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9-]{0,79}', prefix):
    raise SystemExit('invalid stackPrefix')

artifacts = m.get('artifacts', {})
cf = m.get('cloudFormationParameters', {})
for name in ('agentCoreRuntime', 'controlPlaneLambda', 'webLambda'):
    item = artifacts.get(name)
    if not isinstance(item, dict):
        raise SystemExit(f'missing artifact {name}')
    for key in ('key', 'versionId', 'sha256'):
        if not isinstance(item.get(key), str) or not item[key]:
            raise SystemExit(f'invalid {name}.{key}')
    if not re.fullmatch(r'[0-9a-f]{64}', item['sha256']):
        raise SystemExit(f'invalid {name}.sha256')
for name in ('agentCoreRuntime', 'controlPlaneService', 'webApp'):
    if not isinstance(cf.get(name), dict) or not cf[name]:
        raise SystemExit(f'missing cloudFormationParameters.{name}')

parameters = e.get('parameters')
if not isinstance(parameters, dict):
    raise SystemExit('parameters must be object')
for section in ('browser', 'web', 'auth', 'runtime', 'scheduling', 'controlPlaneService'):
    if not isinstance(parameters.get(section), dict):
        raise SystemExit(f'parameters.{section} must be object')
if 'observability' in parameters and not isinstance(parameters['observability'], dict):
    raise SystemExit('invalid observability parameters')

browser = parameters['browser']
browser_name = browser.get('BrowserName')
if not isinstance(browser_name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,47}', browser_name):
    raise SystemExit('parameters.browser.BrowserName must be a valid AgentCore Browser name')

def validate_csv(value, pattern, label):
    if not isinstance(value, str) or not value:
        raise SystemExit(f'parameters.browser.{label} is required')
    items = value.split(',')
    if not 1 <= len(items) <= 16 or any(
        item != item.strip() or not re.fullmatch(pattern, item) for item in items
    ):
        raise SystemExit(f'parameters.browser.{label} must be a comma-separated list of 1-16 valid identifiers')

validate_csv(browser.get('SecurityGroupIds'), r'sg-[0-9A-Za-z]{8,17}', 'SecurityGroupIds')
validate_csv(browser.get('SubnetIds'), r'subnet-[0-9A-Za-z]{8,17}', 'SubnetIds')

reserved = {
    'browser': {'NetworkMode'},
    'web': {
        'WebCodeBucket', 'WebCodeObjectKey', 'WebCodeObjectVersion',
        'ControlPlaneUrl', 'CognitoDomain', 'CognitoAppClientId', 'WebOrigin',
    },
    'auth': {'ControlPlaneLambdaArn', 'WebCallbackUrl', 'WebLogoutUrl'},
    'runtime': {
        'RuntimeCodeBucket', 'RuntimeCodePrefix', 'RuntimeCodeVersionId',
        'CognitoUserPoolId', 'AgentCoreBrowserIdentifier', 'AgentCoreBrowserResourceArn',
    },
    'scheduling': {
        'AgentRuntimeArn', 'DispatcherCodeBucket', 'DispatcherCodeObjectKey',
        'DispatcherCodeObjectVersion', 'DispatcherFunctionArn',
        'DispatcherFunctionRoleName',
    },
    'controlPlaneService': {
        'CodeBucketName', 'CodeObjectKey', 'CodeObjectVersion', 'CognitoIssuer',
        'CognitoAppClientId', 'AgentCoreRuntimeArn', 'AgentCoreBrowserIdentifier',
        'ScheduleDispatchQueueArn', 'ScheduleDispatchDlqArn',
        'SchedulerTargetRoleArn', 'SchedulerGroupName',
        'ScheduledRunStateMachineArn',
    },
    'observability': {'WorkerFunctionRoleName', 'DispatchDeadLetterQueueName'},
}
for section, values in parameters.items():
    bad = sorted(reserved.get(section, set()) & set(values))
    if bad:
        raise SystemExit(
            f'parameters.{section} cannot override derived parameters: {", ".join(bad)}'
        )
    for key, value in values.items():
        if not isinstance(key, str) or not key or not key.replace('_', '').isalnum():
            raise SystemExit(f'invalid parameter name in {section}: {key!r}')
        if not isinstance(value, (str, int, float, bool)) or any(
            char in str(value) for char in ('\n', '\r', '\x00')
        ):
            raise SystemExit(f'invalid parameter {section}.{key}')

print(f'RELEASE_ID={release_id}')
print(f'REGION={region}')
print(f'STACK_PREFIX={prefix}')
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
done <"$meta"

aws_args=(--region "$region")

browser_stack="$stack_prefix-browser"
web_stack="$stack_prefix-web"
auth_stack="$stack_prefix-auth"
runtime_stack="$stack_prefix-runtime"
scheduling_stack="$stack_prefix-scheduling"
service_stack="$stack_prefix-control-plane"
obs_stack="$stack_prefix-observability"

load_params() {
  python3 - "$environment" "$1" <<'PY'
import json
import sys
from pathlib import Path

params = json.loads(Path(sys.argv[1]).read_text())['parameters'].get(sys.argv[2], {})
for key in sorted(params):
    value = params[key]
    print(f"{key}={'true' if value is True else 'false' if value is False else value}")
PY
}

manifest_params() {
  python3 - "$manifest" "$1" <<'PY'
import json
import sys
from pathlib import Path

params = json.loads(Path(sys.argv[1]).read_text())['cloudFormationParameters'][sys.argv[2]]
for key, value in sorted(params.items()):
    print(f'{key}={value}')
PY
}

cf_deploy() {
  local stack="$1"
  local template="$2"
  shift 2
  aws "${aws_args[@]}" cloudformation deploy \
    --stack-name "$stack" \
    --template-file "$ROOT_DIR/$template" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --tags managedBy=automation-platform "releaseId=$release_id" \
    --parameter-overrides "$@"
}

stack_output() {
  local value
  value="$(aws "${aws_args[@]}" cloudformation describe-stacks \
    --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" \
    --output text)"
  [[ -n "$value" && "$value" != None && "$value" != null && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || {
    echo "missing/invalid output $2 from $1" >&2
    exit 6
  }
  printf '%s' "$value"
}

# Provision the deployment-owned custom Browser itself. The CloudFormation resource is
# hard-coded to VPC mode, so public Browser mode cannot be selected by environment JSON.
mapfile -t browser_env < <(load_params browser)
cf_deploy "$browser_stack" infra/aws/agentcore-browser.yaml "${browser_env[@]}"
browser_id="$(stack_output "$browser_stack" BrowserId)"
browser_arn="$(stack_output "$browser_stack" BrowserArn)"
python3 - "$browser_id" "$browser_arn" "$region" <<'PY'
import re
import sys

browser_id, browser_arn, region = sys.argv[1:]
if not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_]{0,47}-[a-zA-Z0-9]{10}', browser_id):
    raise SystemExit('browser stack returned invalid custom Browser ID')
pattern = (
    r'arn:aws(?:-[^:]+)?:bedrock-agentcore:'
    + re.escape(region)
    + r':[0-9]{12}:browser-custom/'
    + re.escape(browser_id)
)
if not re.fullmatch(pattern, browser_arn):
    raise SystemExit('browser stack returned mismatched custom Browser ARN')
PY

# Verify the actual service state before any application stack receives Browser authority.
aws "${aws_args[@]}" bedrock-agentcore-control get-browser \
  --browser-id "$browser_id" \
  --output json >"$browser_state"
python3 - "$browser_state" "$browser_id" "$browser_arn" <<'PY'
import json
import sys
from pathlib import Path

state = json.loads(Path(sys.argv[1]).read_text())
expected_id = sys.argv[2]
expected_arn = sys.argv[3]
if state.get('browserId') != expected_id or state.get('browserArn') != expected_arn:
    raise SystemExit('AgentCore Browser identity does not match deployed browser stack')
if state.get('status') != 'READY':
    raise SystemExit('AgentCore Browser must be READY before application deployment')
network = state.get('networkConfiguration')
if not isinstance(network, dict) or network.get('networkMode') != 'VPC':
    raise SystemExit('AgentCore Browser must use VPC network mode for protected deployment')
vpc = network.get('vpcConfig')
if not isinstance(vpc, dict):
    raise SystemExit('AgentCore Browser VPC configuration is missing')
for key in ('securityGroups', 'subnets'):
    value = vpc.get(key)
    if not isinstance(value, list) or not value or not all(isinstance(item, str) and item for item in value):
        raise SystemExit(f'AgentCore Browser VPC {key} must be non-empty')
PY

mapfile -t web_env < <(load_params web)
mapfile -t web_release < <(manifest_params webApp)
cf_deploy "$web_stack" infra/aws/web-app.yaml "${web_env[@]}" "${web_release[@]}"
web_origin="$(stack_output "$web_stack" WebOrigin)"
web_origin="${web_origin%/}"
python3 - "$web_origin" <<'PY'
import sys
from urllib.parse import urlparse

url = urlparse(sys.argv[1])
if (
    url.scheme != 'https'
    or not url.netloc
    or url.username
    or url.password
    or url.path not in ('', '/')
    or url.query
    or url.fragment
):
    raise SystemExit('web stack returned unsafe origin')
PY

mapfile -t auth_env < <(load_params auth)
cf_deploy "$auth_stack" infra/aws/control-plane-auth.yaml \
  "${auth_env[@]}" \
  "WebCallbackUrl=$web_origin/api/auth/callback" \
  "WebLogoutUrl=$web_origin/"
cognito_issuer="$(stack_output "$auth_stack" CognitoIssuer)"
cognito_client="$(stack_output "$auth_stack" CognitoAppClientId)"
user_pool="$(stack_output "$auth_stack" CognitoUserPoolId)"

mapfile -t runtime_env < <(load_params runtime)
mapfile -t runtime_release < <(manifest_params agentCoreRuntime)
cf_deploy "$runtime_stack" infra/aws/agentcore-runtime.yaml \
  "${runtime_env[@]}" \
  "${runtime_release[@]}" \
  "CognitoUserPoolId=$user_pool" \
  "AgentCoreBrowserIdentifier=$browser_id" \
  "AgentCoreBrowserResourceArn=$browser_arn"
runtime_arn="$(stack_output "$runtime_stack" AgentRuntimeArn)"
runtime_role="$(stack_output "$runtime_stack" AgentRuntimeExecutionRoleArn)"

mapfile -t sched_env < <(load_params scheduling)
mapfile -t control_release < <(manifest_params controlPlaneService)
release_param() {
  printf '%s\n' "${control_release[@]}" | sed -n "s/^$1=//p"
}
cf_deploy "$scheduling_stack" infra/aws/scheduling-dispatch.yaml \
  "${sched_env[@]}" \
  "DispatcherCodeBucket=$(release_param CodeBucketName)" \
  "DispatcherCodeObjectKey=$(release_param CodeObjectKey)" \
  "DispatcherCodeObjectVersion=$(release_param CodeObjectVersion)" \
  "AgentRuntimeArn=$runtime_arn"
q="$(stack_output "$scheduling_stack" DispatchQueueArn)"
dlq="$(stack_output "$scheduling_stack" DispatchDeadLetterQueueArn)"
sched_role="$(stack_output "$scheduling_stack" SchedulerTargetRoleArn)"
sched_group="$(stack_output "$scheduling_stack" SchedulerGroupName)"
sm="$(stack_output "$scheduling_stack" ScheduledRunStateMachineArn)"

mapfile -t service_env < <(load_params controlPlaneService)
cf_deploy "$service_stack" infra/aws/control-plane-service.yaml \
  "${service_env[@]}" \
  "${control_release[@]}" \
  "CognitoIssuer=$cognito_issuer" \
  "CognitoAppClientId=$cognito_client" \
  "AgentCoreRuntimeArn=$runtime_arn" \
  "AgentCoreBrowserIdentifier=$browser_id" \
  "ScheduleDispatchQueueArn=$q" \
  "ScheduleDispatchDlqArn=$dlq" \
  "SchedulerTargetRoleArn=$sched_role" \
  "SchedulerGroupName=$sched_group" \
  "ScheduledRunStateMachineArn=$sm"
control_lambda="$(stack_output "$service_stack" ControlPlaneLambdaArn)"
capture_endpoint="$(stack_output "$service_stack" CaptureCompletionApiEndpoint)"
capture_invoke="$(stack_output "$service_stack" CaptureCompletionInvokeArn)"

cf_deploy "$auth_stack" infra/aws/control-plane-auth.yaml \
  "${auth_env[@]}" \
  "WebCallbackUrl=$web_origin/api/auth/callback" \
  "WebLogoutUrl=$web_origin/" \
  "ControlPlaneLambdaArn=$control_lambda"
control_url="$(stack_output "$auth_stack" ControlPlaneUrl)"
cognito_domain="$(stack_output "$auth_stack" CognitoDomain)"

cf_deploy "$web_stack" infra/aws/web-app.yaml \
  "${web_env[@]}" \
  "${web_release[@]}" \
  "ControlPlaneUrl=$control_url" \
  "CognitoDomain=$cognito_domain" \
  "CognitoAppClientId=$cognito_client" \
  "WebOrigin=$web_origin"

observability=false
has_observability="$(python3 - "$environment" <<'PY'
import json
import sys
from pathlib import Path

params = json.loads(Path(sys.argv[1]).read_text()).get('parameters', {}).get('observability')
print('yes' if isinstance(params, dict) and params else 'no')
PY
)"
if [[ "$has_observability" == yes ]]; then
  mapfile -t obs_env < <(load_params observability)
  cf_deploy "$obs_stack" infra/aws/observability-notifications.yaml \
    "${obs_env[@]}" \
    "WorkerFunctionRoleName=${runtime_role##*/}" \
    "DispatchDeadLetterQueueName=${dlq##*:}"
  observability=true
fi

[[ -n "$output" ]] || output="$ROOT_DIR/dist/aws-deployment-$release_id.json"
mkdir -p "$(dirname "$output")"
tmp="$output.tmp"
RELEASE_ID="$release_id" \
REGION="$region" \
PREFIX="$stack_prefix" \
BROWSER_STACK="$browser_stack" \
WEB_STACK="$web_stack" \
AUTH_STACK="$auth_stack" \
RUNTIME_STACK="$runtime_stack" \
SCHED_STACK="$scheduling_stack" \
SERVICE_STACK="$service_stack" \
OBS_STACK="$obs_stack" \
OBS="$observability" \
WEB_ORIGIN="$web_origin" \
CONTROL_URL="$control_url" \
COGNITO_DOMAIN="$cognito_domain" \
RUNTIME_ARN="$runtime_arn" \
BROWSER_ID="$browser_id" \
BROWSER_ARN="$browser_arn" \
CAPTURE_ENDPOINT="$capture_endpoint" \
CAPTURE_INVOKE="$capture_invoke" \
python3 >"$tmp" <<'PY'
import json
import os

print(json.dumps({
    'schemaVersion': 1,
    'releaseId': os.environ['RELEASE_ID'],
    'region': os.environ['REGION'],
    'stackPrefix': os.environ['PREFIX'],
    'stacks': {
        'agentCoreBrowser': os.environ['BROWSER_STACK'],
        'web': os.environ['WEB_STACK'],
        'auth': os.environ['AUTH_STACK'],
        'agentCoreRuntime': os.environ['RUNTIME_STACK'],
        'scheduling': os.environ['SCHED_STACK'],
        'controlPlaneService': os.environ['SERVICE_STACK'],
        'observability': os.environ['OBS_STACK'] if os.environ['OBS'] == 'true' else None,
    },
    'outputs': {
        'webOrigin': os.environ['WEB_ORIGIN'],
        'controlPlaneUrl': os.environ['CONTROL_URL'],
        'cognitoDomain': os.environ['COGNITO_DOMAIN'],
        'agentRuntimeArn': os.environ['RUNTIME_ARN'],
        'agentCoreBrowserIdentifier': os.environ['BROWSER_ID'],
        'agentCoreBrowserArn': os.environ['BROWSER_ARN'],
        'captureCompletionApiEndpoint': os.environ['CAPTURE_ENDPOINT'],
        'captureCompletionInvokeArn': os.environ['CAPTURE_INVOKE'],
    },
}, indent=2, sort_keys=True))
PY
mv "$tmp" "$output"
printf 'Deployment result: %s\n' "$output"
