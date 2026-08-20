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

args=" $* "
if [[ "$args" == *" cloudformation deploy "* ]]; then
  exit 0
fi
if [[ "$args" == *" cloudformation describe-stacks "* ]]; then
  stack=""
  query=""
  while (($#)); do
    case "$1" in
      --stack-name) stack="${2:-}"; shift 2 ;;
      --query) query="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done
  case "$query" in
    *CognitoIssuer*) printf '%s\n' 'https://cognito-idp.ap-south-1.amazonaws.com/pool-123' ;;
    *CognitoAppClientId*) printf '%s\n' 'client-123' ;;
    *CognitoUserPoolId*) printf '%s\n' 'pool-123' ;;
    *AgentRuntimeExecutionRoleArn*) printf '%s\n' 'arn:aws:iam::123456789012:role/automation-dev-runtime-role' ;;
    *AgentRuntimeArn*) printf '%s\n' 'arn:aws:bedrock-agentcore:ap-south-1:123456789012:runtime/runtime-123' ;;
    *DispatchQueueArn*) printf '%s\n' 'arn:aws:sqs:ap-south-1:123456789012:automation-dev-dispatch' ;;
    *DispatchDeadLetterQueueArn*) printf '%s\n' 'arn:aws:sqs:ap-south-1:123456789012:automation-dev-dispatch-dlq' ;;
    *SchedulerTargetRoleArn*) printf '%s\n' 'arn:aws:iam::123456789012:role/scheduler-role' ;;
    *SchedulerGroupName*) printf '%s\n' 'automation-dev' ;;
    *ScheduledRunStateMachineArn*) printf '%s\n' 'arn:aws:states:ap-south-1:123456789012:stateMachine:scheduled-run' ;;
    *ControlPlaneLambdaArn*) printf '%s\n' 'arn:aws:lambda:ap-south-1:123456789012:function:control-plane' ;;
    *CaptureCompletionApiEndpoint*) printf '%s\n' 'https://capture.example.test/capture/complete' ;;
    *CaptureCompletionInvokeArn*) printf '%s\n' 'arn:aws:execute-api:ap-south-1:123456789012:capture/*/POST/capture/complete' ;;
    *ControlPlaneUrl*) printf '%s\n' 'https://api.example.test' ;;
    *CognitoDomain*) printf '%s\n' 'https://automation-dev.auth.ap-south-1.amazoncognito.com' ;;
    *) echo "unexpected describe query for $stack: $query" >&2; exit 94 ;;
  esac
  exit 0
fi
echo "unexpected aws command: $*" >&2
exit 93
AWS
chmod +x "$WORK_DIR/bin/aws"
export PATH="$WORK_DIR/bin:$PATH"
export AWS_LOG

cat >"$WORK_DIR/release.json" <<'JSON'
{
  "schemaVersion": 1,
  "releaseId": "abc123",
  "region": "ap-south-1",
  "bucket": "release-bucket",
  "artifacts": {
    "agentCoreRuntime": {
      "key": "releases/abc123/runtime.zip",
      "versionId": "runtime-version-1",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "controlPlaneLambda": {
      "key": "releases/abc123/control.zip",
      "versionId": "control-version-1",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  },
  "cloudFormationParameters": {
    "agentCoreRuntime": {
      "RuntimeCodeBucket": "release-bucket",
      "RuntimeCodePrefix": "releases/abc123/runtime.zip",
      "RuntimeCodeVersionId": "runtime-version-1"
    },
    "controlPlaneService": {
      "CodeBucketName": "release-bucket",
      "CodeObjectKey": "releases/abc123/control.zip",
      "CodeObjectVersion": "control-version-1"
    }
  }
}
JSON

cat >"$WORK_DIR/environment.json" <<'JSON'
{
  "schemaVersion": 1,
  "region": "ap-south-1",
  "stackPrefix": "automation-dev",
  "parameters": {
    "auth": {
      "WebCallbackUrl": "https://app.example.test/api/auth/callback",
      "WebLogoutUrl": "https://app.example.test/",
      "UserPoolDomainPrefix": "automation-dev-test"
    },
    "runtime": {
      "EnvironmentName": "dev",
      "AutomationTenantId": "tenant-dev",
      "StateTableName": "automation-dev-state",
      "ArtifactBucketName": "automation-dev-artifacts",
      "AgentCoreBrowserResourceArn": "arn:aws:bedrock-agentcore:ap-south-1:123456789012:browser/browser-123",
      "OpenAiByokModel": "gpt-5-mini"
    },
    "scheduling": {
      "EnvironmentName": "dev",
      "DispatcherFunctionArn": "arn:aws:lambda:ap-south-1:123456789012:function:dispatcher",
      "DispatcherFunctionRoleName": "dispatcher-role"
    },
    "controlPlaneService": {
      "EnvironmentName": "dev",
      "StateTableName": "automation-dev-state",
      "ArtifactBucketName": "automation-dev-artifacts",
      "TenantId": "tenant-dev"
    },
    "observability": {
      "EnvironmentName": "dev",
      "SesFromIdentityArn": "arn:aws:ses:ap-south-1:123456789012:identity/notifications.example.test"
    }
  }
}
JSON

result="$WORK_DIR/deployment.json"
bash "$ROOT_DIR/scripts/deploy-aws-release.sh" \
  --manifest "$WORK_DIR/release.json" \
  --environment "$WORK_DIR/environment.json" \
  --output "$result" >/dev/null

python3 - "$result" "$AWS_LOG" <<'PY'
import json
import shlex
import sys
from pathlib import Path

result = json.loads(Path(sys.argv[1]).read_text())
assert result["schemaVersion"] == 1
assert result["releaseId"] == "abc123"
assert result["region"] == "ap-south-1"
assert result["stacks"] == {
    "agentCoreRuntime": "automation-dev-runtime",
    "auth": "automation-dev-auth",
    "controlPlaneService": "automation-dev-control-plane",
    "observability": "automation-dev-observability",
    "scheduling": "automation-dev-scheduling",
}
assert result["outputs"]["controlPlaneUrl"] == "https://api.example.test"
assert result["outputs"]["captureCompletionInvokeArn"].endswith("/POST/capture/complete")

commands = [shlex.split(line) for line in Path(sys.argv[2]).read_text().splitlines()]
deploys = [c for c in commands if "cloudformation" in c and "deploy" in c]
assert len(deploys) == 6, deploys

def value(command, flag):
    return command[command.index(flag) + 1]

assert [value(c, "--stack-name") for c in deploys] == [
    "automation-dev-auth",
    "automation-dev-runtime",
    "automation-dev-scheduling",
    "automation-dev-control-plane",
    "automation-dev-auth",
    "automation-dev-observability",
]
first_auth = deploys[0]
final_auth = deploys[4]
assert not any(x.startswith("ControlPlaneLambdaArn=") for x in first_auth)
assert any(x == "ControlPlaneLambdaArn=arn:aws:lambda:ap-south-1:123456789012:function:control-plane" for x in final_auth)
runtime = deploys[1]
assert "RuntimeCodeVersionId=runtime-version-1" in runtime
assert "CognitoUserPoolId=pool-123" in runtime
scheduling = deploys[2]
assert "AgentRuntimeArn=arn:aws:bedrock-agentcore:ap-south-1:123456789012:runtime/runtime-123" in scheduling
service = deploys[3]
assert "CodeObjectVersion=control-version-1" in service
assert "CognitoAppClientId=client-123" in service
assert "SchedulerGroupName=automation-dev" in service
observability = deploys[5]
assert "WorkerFunctionRoleName=automation-dev-runtime-role" in observability
assert "DispatchDeadLetterQueueName=automation-dev-dispatch-dlq" in observability
for command in deploys:
    assert "CAPABILITY_NAMED_IAM" in command
    assert "managedBy=automation-platform" in command
    assert "releaseId=abc123" in command
PY

# The release manifest is authoritative for artifact coordinates. Environment
# configuration must not be able to replace an immutable VersionId.
python3 - "$WORK_DIR/environment.json" "$WORK_DIR/conflict.json" <<'PY'
import json, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
data["parameters"]["runtime"]["RuntimeCodeVersionId"] = "attacker-version"
Path(sys.argv[2]).write_text(json.dumps(data))
PY
: >"$AWS_LOG"
if bash "$ROOT_DIR/scripts/deploy-aws-release.sh" \
  --manifest "$WORK_DIR/release.json" \
  --environment "$WORK_DIR/conflict.json" \
  --output "$WORK_DIR/conflict-result.json" >/dev/null 2>&1; then
  echo "deployment unexpectedly accepted a derived-parameter override" >&2
  exit 1
fi
[[ ! -s "$AWS_LOG" ]]
[[ ! -f "$WORK_DIR/conflict-result.json" ]]

# Region mismatch fails before any AWS call so a release cannot accidentally be
# deployed into a different regional control plane.
python3 - "$WORK_DIR/environment.json" "$WORK_DIR/wrong-region.json" <<'PY'
import json, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
data["region"] = "us-east-1"
Path(sys.argv[2]).write_text(json.dumps(data))
PY
: >"$AWS_LOG"
if bash "$ROOT_DIR/scripts/deploy-aws-release.sh" \
  --manifest "$WORK_DIR/release.json" \
  --environment "$WORK_DIR/wrong-region.json" \
  --output "$WORK_DIR/wrong-region-result.json" >/dev/null 2>&1; then
  echo "deployment unexpectedly accepted a release/environment region mismatch" >&2
  exit 1
fi
[[ ! -s "$AWS_LOG" ]]

printf 'deploy-aws-release tests passed\n'
