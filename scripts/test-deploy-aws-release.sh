#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; WORK_DIR="$(mktemp -d)"; trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/bin"; AWS_LOG="$WORK_DIR/aws.log"
cat >"$WORK_DIR/bin/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
: "${AWS_LOG:?}"; printf '%q ' "$@" >>"$AWS_LOG"; printf '\n' >>"$AWS_LOG"
[[ " $* " == *" cloudformation deploy "* ]] && exit 0
if [[ " $* " == *" cloudformation describe-stacks "* ]]; then
  query=""; while (($#)); do case "$1" in --query) query="${2:-}"; shift 2;; *) shift;; esac; done
  case "$query" in
    *CognitoIssuer*) echo 'https://cognito-idp.ap-south-1.amazonaws.com/pool-123';;
    *CognitoAppClientId*) echo client-123;; *CognitoUserPoolId*) echo pool-123;;
    *AgentRuntimeExecutionRoleArn*) echo 'arn:aws:iam::123456789012:role/automation-dev-runtime-role';;
    *AgentRuntimeArn*) echo 'arn:aws:bedrock-agentcore:ap-south-1:123456789012:runtime/runtime-123';;
    *DispatchQueueArn*) echo 'arn:aws:sqs:ap-south-1:123456789012:automation-dev-dispatch';;
    *DispatchDeadLetterQueueArn*) echo 'arn:aws:sqs:ap-south-1:123456789012:automation-dev-dispatch-dlq';;
    *SchedulerTargetRoleArn*) echo 'arn:aws:iam::123456789012:role/scheduler-role';; *SchedulerGroupName*) echo automation-dev;;
    *ScheduledRunStateMachineArn*) echo 'arn:aws:states:ap-south-1:123456789012:stateMachine:scheduled-run';;
    *ControlPlaneLambdaArn*) echo 'arn:aws:lambda:ap-south-1:123456789012:function:control-plane';;
    *CaptureCompletionApiEndpoint*) echo 'https://capture.example.test/capture/complete';;
    *CaptureCompletionInvokeArn*) echo 'arn:aws:execute-api:ap-south-1:123456789012:capture/*/POST/capture/complete';;
    *ControlPlaneUrl*) echo 'https://api.example.test';; *CognitoDomain*) echo 'https://automation-dev.auth.ap-south-1.amazoncognito.com';;
    *) exit 94;; esac; exit 0
fi
exit 93
AWS
chmod +x "$WORK_DIR/bin/aws"; export PATH="$WORK_DIR/bin:$PATH" AWS_LOG
cat >"$WORK_DIR/release.json" <<'JSON'
{"schemaVersion":1,"releaseId":"abc123","region":"ap-south-1","bucket":"release-bucket","artifacts":{"agentCoreRuntime":{"key":"releases/abc123/runtime.zip","versionId":"runtime-version-1","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"controlPlaneLambda":{"key":"releases/abc123/control.zip","versionId":"control-version-1","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}},"cloudFormationParameters":{"agentCoreRuntime":{"RuntimeCodeBucket":"release-bucket","RuntimeCodePrefix":"releases/abc123/runtime.zip","RuntimeCodeVersionId":"runtime-version-1"},"controlPlaneService":{"CodeBucketName":"release-bucket","CodeObjectKey":"releases/abc123/control.zip","CodeObjectVersion":"control-version-1"}}}
JSON
cat >"$WORK_DIR/environment.json" <<'JSON'
{"schemaVersion":1,"region":"ap-south-1","stackPrefix":"automation-dev","parameters":{"auth":{"WebCallbackUrl":"https://app.example.test/api/auth/callback","WebLogoutUrl":"https://app.example.test/","UserPoolDomainPrefix":"automation-dev-test"},"runtime":{"EnvironmentName":"dev","AutomationTenantId":"tenant-dev","StateTableName":"automation-dev-state","ArtifactBucketName":"automation-dev-artifacts","AgentCoreBrowserResourceArn":"arn:aws:bedrock-agentcore:ap-south-1:123456789012:browser/browser-123","OpenAiByokModel":"gpt-5-mini"},"scheduling":{"EnvironmentName":"dev"},"controlPlaneService":{"EnvironmentName":"dev","StateTableName":"automation-dev-state","ArtifactBucketName":"automation-dev-artifacts","TenantId":"tenant-dev"},"observability":{"EnvironmentName":"dev","SesFromIdentityArn":"arn:aws:ses:ap-south-1:123456789012:identity/notifications.example.test"}}}
JSON
result="$WORK_DIR/deployment.json"; bash "$ROOT_DIR/scripts/deploy-aws-release.sh" --manifest "$WORK_DIR/release.json" --environment "$WORK_DIR/environment.json" --output "$result" >/dev/null
python3 - "$result" "$AWS_LOG" <<'PY'
import json,shlex,sys
from pathlib import Path
r=json.loads(Path(sys.argv[1]).read_text()); assert r["releaseId"]=="abc123"
commands=[shlex.split(x) for x in Path(sys.argv[2]).read_text().splitlines()]; deploys=[c for c in commands if "cloudformation" in c and "deploy" in c]
assert len(deploys)==6
def v(c,f): return c[c.index(f)+1]
assert [v(c,"--stack-name") for c in deploys]==["automation-dev-auth","automation-dev-runtime","automation-dev-scheduling","automation-dev-control-plane","automation-dev-auth","automation-dev-observability"]
s=deploys[2]
assert "AgentRuntimeArn=arn:aws:bedrock-agentcore:ap-south-1:123456789012:runtime/runtime-123" in s
assert "DispatcherCodeBucket=release-bucket" in s
assert "DispatcherCodeObjectKey=releases/abc123/control.zip" in s
assert "DispatcherCodeObjectVersion=control-version-1" in s
assert not any(x.startswith("DispatcherFunctionArn=") or x.startswith("DispatcherFunctionRoleName=") for x in s)
assert "CodeObjectVersion=control-version-1" in deploys[3]
for c in deploys: assert "CAPABILITY_NAMED_IAM" in c and "releaseId=abc123" in c
PY
# Environment cannot replace dispatcher artifact coordinates or reintroduce an externally owned dispatcher.
python3 - "$WORK_DIR/environment.json" "$WORK_DIR/conflict.json" <<'PY'
import json,sys
from pathlib import Path
d=json.loads(Path(sys.argv[1]).read_text()); d["parameters"]["scheduling"]["DispatcherCodeObjectVersion"]="attacker"; Path(sys.argv[2]).write_text(json.dumps(d))
PY
: >"$AWS_LOG"
if bash "$ROOT_DIR/scripts/deploy-aws-release.sh" --manifest "$WORK_DIR/release.json" --environment "$WORK_DIR/conflict.json" --output "$WORK_DIR/conflict-result.json" >/dev/null 2>&1; then echo "deployment accepted dispatcher artifact override" >&2; exit 1; fi
[[ ! -s "$AWS_LOG" ]]
printf 'deploy-aws-release tests passed\n'
