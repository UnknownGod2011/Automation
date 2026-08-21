#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest=""; environment=""; output=""; while (($#)); do case "$1" in --manifest) manifest="${2:-}";shift 2;; --environment) environment="${2:-}";shift 2;; --output) output="${2:-}";shift 2;; -h|--help) echo 'Usage: deploy-aws-release.sh --manifest PATH --environment PATH [--output PATH]';exit 0;; *) echo "Unknown argument: $1" >&2; exit 2;; esac; done
[[ -f "$manifest" && -f "$environment" ]] || { echo "valid --manifest and --environment are required" >&2; exit 2; }; command -v aws >/dev/null || exit 2; command -v python3 >/dev/null || exit 2; export AWS_PAGER=""
meta="$(mktemp)"; trap 'rm -f "$meta"' EXIT
python3 - "$manifest" "$environment" >"$meta" <<'PY'
import json,re,sys
from pathlib import Path
m=json.loads(Path(sys.argv[1]).read_text()); e=json.loads(Path(sys.argv[2]).read_text())
if m.get('schemaVersion')!=1 or e.get('schemaVersion')!=1: raise SystemExit('unsupported schemaVersion')
r=m.get('releaseId'); region=e.get('region'); prefix=e.get('stackPrefix')
if not isinstance(r,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}',r): raise SystemExit('invalid releaseId')
if not isinstance(region,str) or not re.fullmatch(r'[a-z]{2}(?:-gov)?-[a-z]+-\d',region): raise SystemExit('invalid region')
if m.get('region') not in (None,'',region): raise SystemExit('release region mismatch')
if not isinstance(prefix,str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9-]{0,79}',prefix): raise SystemExit('invalid stackPrefix')
arts=m.get('artifacts',{}); cf=m.get('cloudFormationParameters',{})
for n in ('agentCoreRuntime','controlPlaneLambda','webLambda'):
 i=arts.get(n)
 if not isinstance(i,dict): raise SystemExit(f'missing artifact {n}')
 for k in ('key','versionId','sha256'):
  if not isinstance(i.get(k),str) or not i[k]: raise SystemExit(f'invalid {n}.{k}')
 if not re.fullmatch(r'[0-9a-f]{64}',i['sha256']): raise SystemExit(f'invalid {n}.sha256')
for n in ('agentCoreRuntime','controlPlaneService','webApp'):
 if not isinstance(cf.get(n),dict) or not cf[n]: raise SystemExit(f'missing cloudFormationParameters.{n}')
p=e.get('parameters')
if not isinstance(p,dict): raise SystemExit('parameters must be object')
for s in ('web','auth','runtime','scheduling','controlPlaneService'):
 if not isinstance(p.get(s),dict): raise SystemExit(f'parameters.{s} must be object')
if 'observability' in p and not isinstance(p['observability'],dict): raise SystemExit('invalid observability parameters')
reserved={'web':{'WebCodeBucket','WebCodeObjectKey','WebCodeObjectVersion','ControlPlaneUrl','CognitoDomain','CognitoAppClientId','WebOrigin'},'auth':{'ControlPlaneLambdaArn','WebCallbackUrl','WebLogoutUrl'},'runtime':{'RuntimeCodeBucket','RuntimeCodePrefix','RuntimeCodeVersionId','CognitoUserPoolId'},'scheduling':{'AgentRuntimeArn','DispatcherCodeBucket','DispatcherCodeObjectKey','DispatcherCodeObjectVersion','DispatcherFunctionArn','DispatcherFunctionRoleName'},'controlPlaneService':{'CodeBucketName','CodeObjectKey','CodeObjectVersion','CognitoIssuer','CognitoAppClientId','AgentCoreRuntimeArn','ScheduleDispatchQueueArn','ScheduleDispatchDlqArn','SchedulerTargetRoleArn','SchedulerGroupName','ScheduledRunStateMachineArn'},'observability':{'WorkerFunctionRoleName','DispatchDeadLetterQueueName'}}
for s,v in p.items():
 bad=sorted(reserved.get(s,set())&set(v))
 if bad: raise SystemExit(f'parameters.{s} cannot override derived parameters: {", ".join(bad)}')
 for k,x in v.items():
  if not isinstance(k,str) or not k or not k.replace('_','').isalnum(): raise SystemExit(f'invalid parameter name in {s}: {k!r}')
  if not isinstance(x,(str,int,float,bool)) or any(c in str(x) for c in ('\n','\r','\x00')): raise SystemExit(f'invalid parameter {s}.{k}')
print(f'RELEASE_ID={r}');print(f'REGION={region}');print(f'STACK_PREFIX={prefix}')
PY
release_id=""; region=""; stack_prefix=""; while IFS='=' read -r k v; do case "$k" in RELEASE_ID) release_id="$v";; REGION) region="$v";; STACK_PREFIX) stack_prefix="$v";; esac; done <"$meta"
aws_args=(--region "$region"); web_stack="$stack_prefix-web"; auth_stack="$stack_prefix-auth"; runtime_stack="$stack_prefix-runtime"; scheduling_stack="$stack_prefix-scheduling"; service_stack="$stack_prefix-control-plane"; obs_stack="$stack_prefix-observability"
load_params(){ python3 - "$environment" "$1" <<'PY'
import json,sys
from pathlib import Path
p=json.loads(Path(sys.argv[1]).read_text())['parameters'].get(sys.argv[2],{})
for k in sorted(p):
 v=p[k]; print(f"{k}={'true' if v is True else 'false' if v is False else v}")
PY
}
manifest_params(){ python3 - "$manifest" "$1" <<'PY'
import json,sys
from pathlib import Path
p=json.loads(Path(sys.argv[1]).read_text())['cloudFormationParameters'][sys.argv[2]]
for k,v in sorted(p.items()): print(f'{k}={v}')
PY
}
cf_deploy(){ local s="$1" t="$2";shift 2; aws "${aws_args[@]}" cloudformation deploy --stack-name "$s" --template-file "$ROOT_DIR/$t" --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --tags managedBy=automation-platform "releaseId=$release_id" --parameter-overrides "$@"; }
stack_output(){ local v; v="$(aws "${aws_args[@]}" cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text)"; [[ -n "$v" && "$v" != None && "$v" != null && "$v" != *$'\n'* && "$v" != *$'\r'* ]] || { echo "missing/invalid output $2 from $1" >&2; exit 6; }; printf '%s' "$v"; }
mapfile -t web_env < <(load_params web); mapfile -t web_release < <(manifest_params webApp)
cf_deploy "$web_stack" infra/aws/web-app.yaml "${web_env[@]}" "${web_release[@]}"
web_origin="$(stack_output "$web_stack" WebOrigin)"; web_origin="${web_origin%/}"
python3 - "$web_origin" <<'PY'
import sys
from urllib.parse import urlparse
u=urlparse(sys.argv[1])
if u.scheme!='https' or not u.netloc or u.username or u.password or u.path not in ('','/') or u.query or u.fragment: raise SystemExit('web stack returned unsafe origin')
PY
mapfile -t auth_env < <(load_params auth)
cf_deploy "$auth_stack" infra/aws/control-plane-auth.yaml "${auth_env[@]}" "WebCallbackUrl=$web_origin/api/auth/callback" "WebLogoutUrl=$web_origin/"
cognito_issuer="$(stack_output "$auth_stack" CognitoIssuer)"; cognito_client="$(stack_output "$auth_stack" CognitoAppClientId)"; user_pool="$(stack_output "$auth_stack" CognitoUserPoolId)"
mapfile -t runtime_env < <(load_params runtime); mapfile -t runtime_release < <(manifest_params agentCoreRuntime)
cf_deploy "$runtime_stack" infra/aws/agentcore-runtime.yaml "${runtime_env[@]}" "${runtime_release[@]}" "CognitoUserPoolId=$user_pool"
runtime_arn="$(stack_output "$runtime_stack" AgentRuntimeArn)"; runtime_role="$(stack_output "$runtime_stack" AgentRuntimeExecutionRoleArn)"
mapfile -t sched_env < <(load_params scheduling); mapfile -t control_release < <(manifest_params controlPlaneService)
release_param(){ printf '%s\n' "${control_release[@]}" | sed -n "s/^$1=//p"; }
cf_deploy "$scheduling_stack" infra/aws/scheduling-dispatch.yaml "${sched_env[@]}" "DispatcherCodeBucket=$(release_param CodeBucketName)" "DispatcherCodeObjectKey=$(release_param CodeObjectKey)" "DispatcherCodeObjectVersion=$(release_param CodeObjectVersion)" "AgentRuntimeArn=$runtime_arn"
q="$(stack_output "$scheduling_stack" DispatchQueueArn)"; dlq="$(stack_output "$scheduling_stack" DispatchDeadLetterQueueArn)"; sched_role="$(stack_output "$scheduling_stack" SchedulerTargetRoleArn)"; sched_group="$(stack_output "$scheduling_stack" SchedulerGroupName)"; sm="$(stack_output "$scheduling_stack" ScheduledRunStateMachineArn)"
mapfile -t service_env < <(load_params controlPlaneService)
cf_deploy "$service_stack" infra/aws/control-plane-service.yaml "${service_env[@]}" "${control_release[@]}" "CognitoIssuer=$cognito_issuer" "CognitoAppClientId=$cognito_client" "AgentCoreRuntimeArn=$runtime_arn" "ScheduleDispatchQueueArn=$q" "ScheduleDispatchDlqArn=$dlq" "SchedulerTargetRoleArn=$sched_role" "SchedulerGroupName=$sched_group" "ScheduledRunStateMachineArn=$sm"
control_lambda="$(stack_output "$service_stack" ControlPlaneLambdaArn)"; capture_endpoint="$(stack_output "$service_stack" CaptureCompletionApiEndpoint)"; capture_invoke="$(stack_output "$service_stack" CaptureCompletionInvokeArn)"
cf_deploy "$auth_stack" infra/aws/control-plane-auth.yaml "${auth_env[@]}" "WebCallbackUrl=$web_origin/api/auth/callback" "WebLogoutUrl=$web_origin/" "ControlPlaneLambdaArn=$control_lambda"
control_url="$(stack_output "$auth_stack" ControlPlaneUrl)"; cognito_domain="$(stack_output "$auth_stack" CognitoDomain)"
cf_deploy "$web_stack" infra/aws/web-app.yaml "${web_env[@]}" "${web_release[@]}" "ControlPlaneUrl=$control_url" "CognitoDomain=$cognito_domain" "CognitoAppClientId=$cognito_client" "WebOrigin=$web_origin"
obs=false; has_obs="$(python3 - "$environment" <<'PY'
import json,sys
from pathlib import Path
p=json.loads(Path(sys.argv[1]).read_text()).get('parameters',{}).get('observability'); print('yes' if isinstance(p,dict) and p else 'no')
PY
)"; if [[ "$has_obs" == yes ]]; then mapfile -t obs_env < <(load_params observability); cf_deploy "$obs_stack" infra/aws/observability-notifications.yaml "${obs_env[@]}" "WorkerFunctionRoleName=${runtime_role##*/}" "DispatchDeadLetterQueueName=${dlq##*:}"; obs=true; fi
[[ -n "$output" ]] || output="$ROOT_DIR/dist/aws-deployment-$release_id.json"; mkdir -p "$(dirname "$output")"; tmp="$output.tmp"
RELEASE_ID="$release_id" REGION="$region" PREFIX="$stack_prefix" WEB_STACK="$web_stack" AUTH_STACK="$auth_stack" RUNTIME_STACK="$runtime_stack" SCHED_STACK="$scheduling_stack" SERVICE_STACK="$service_stack" OBS_STACK="$obs_stack" OBS="$obs" WEB_ORIGIN="$web_origin" CONTROL_URL="$control_url" COGNITO_DOMAIN="$cognito_domain" RUNTIME_ARN="$runtime_arn" CAPTURE_ENDPOINT="$capture_endpoint" CAPTURE_INVOKE="$capture_invoke" python3 >"$tmp" <<'PY'
import json,os
print(json.dumps({'schemaVersion':1,'releaseId':os.environ['RELEASE_ID'],'region':os.environ['REGION'],'stackPrefix':os.environ['PREFIX'],'stacks':{'web':os.environ['WEB_STACK'],'auth':os.environ['AUTH_STACK'],'agentCoreRuntime':os.environ['RUNTIME_STACK'],'scheduling':os.environ['SCHED_STACK'],'controlPlaneService':os.environ['SERVICE_STACK'],'observability':os.environ['OBS_STACK'] if os.environ['OBS']=='true' else None},'outputs':{'webOrigin':os.environ['WEB_ORIGIN'],'controlPlaneUrl':os.environ['CONTROL_URL'],'cognitoDomain':os.environ['COGNITO_DOMAIN'],'agentRuntimeArn':os.environ['RUNTIME_ARN'],'captureCompletionApiEndpoint':os.environ['CAPTURE_ENDPOINT'],'captureCompletionInvokeArn':os.environ['CAPTURE_INVOKE']}},indent=2,sort_keys=True))
PY
mv "$tmp" "$output"; printf 'Deployment result: %s\n' "$output"
