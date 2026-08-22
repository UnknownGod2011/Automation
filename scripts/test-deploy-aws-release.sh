#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"
AWS_LOG="$W/aws.log"

cat >"$W/bin/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >>"$AWS_LOG"
printf '\n' >>"$AWS_LOG"

if [[ " $* " == *' bedrock-agentcore-control get-browser '* ]]; then
  browser_id=""
  while (($#)); do
    if [[ "$1" == --browser-id ]]; then
      browser_id="$2"
      break
    fi
    shift
  done
  mode="${FAKE_BROWSER_MODE:-VPC}"
  status="${FAKE_BROWSER_STATUS:-READY}"
  arn="arn:aws:bedrock-agentcore:ap-south-1:123456789012:browser-custom/$browser_id"
  printf '{"browserId":"%s","browserArn":"%s","status":"%s","networkConfiguration":{"networkMode":"%s","vpcConfig":{"securityGroups":["sg-12345678"],"subnets":["subnet-12345678"]}}}\n' \
    "$browser_id" "$arn" "$status" "$mode"
  exit 0
fi

[[ " $* " == *' cloudformation deploy '* ]] && exit 0
if [[ " $* " == *' cloudformation describe-stacks '* ]]; then
  query=""
  while (($#)); do
    if [[ "$1" == --query ]]; then
      query="$2"
      break
    fi
    shift
  done
  case "$query" in
    *WebOrigin*) echo 'https://web.lambda-url.ap-south-1.on.aws/' ;;
    *CognitoIssuer*) echo 'https://cognito-idp.ap-south-1.amazonaws.com/pool' ;;
    *CognitoAppClientId*) echo client ;;
    *CognitoUserPoolId*) echo pool ;;
    *AgentRuntimeExecutionRoleArn*) echo 'arn:aws:iam::123456789012:role/runtime-role' ;;
    *AgentRuntimeArn*) echo 'arn:aws:bedrock-agentcore:ap-south-1:123456789012:runtime/r' ;;
    *DispatchQueueArn*) echo 'arn:aws:sqs:ap-south-1:123456789012:q' ;;
    *DispatchDeadLetterQueueArn*) echo 'arn:aws:sqs:ap-south-1:123456789012:dlq' ;;
    *SchedulerTargetRoleArn*) echo 'arn:aws:iam::123456789012:role/scheduler' ;;
    *SchedulerGroupName*) echo group ;;
    *ScheduledRunStateMachineArn*) echo 'arn:aws:states:ap-south-1:123456789012:stateMachine:sm' ;;
    *ControlPlaneLambdaArn*) echo 'arn:aws:lambda:ap-south-1:123456789012:function:cp' ;;
    *CaptureCompletionApiEndpoint*) echo 'https://capture.example/capture/complete' ;;
    *CaptureCompletionInvokeArn*) echo 'arn:aws:execute-api:ap-south-1:123456789012:c/*' ;;
    *ControlPlaneUrl*) echo 'https://api.example' ;;
    *CognitoDomain*) echo 'https://login.auth.ap-south-1.amazoncognito.com' ;;
    *) exit 94 ;;
  esac
  exit 0
fi
exit 93
AWS
chmod +x "$W/bin/aws"
export PATH="$W/bin:$PATH" AWS_LOG

cat >"$W/release.json" <<'JSON'
{"schemaVersion":1,"releaseId":"abc123","region":"ap-south-1","artifacts":{"agentCoreRuntime":{"key":"r.zip","versionId":"rv","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"controlPlaneLambda":{"key":"c.zip","versionId":"cv","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"webLambda":{"key":"w.zip","versionId":"wv","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}},"cloudFormationParameters":{"agentCoreRuntime":{"RuntimeCodeBucket":"release","RuntimeCodePrefix":"r.zip","RuntimeCodeVersionId":"rv"},"controlPlaneService":{"CodeBucketName":"release","CodeObjectKey":"c.zip","CodeObjectVersion":"cv"},"webApp":{"WebCodeBucket":"release","WebCodeObjectKey":"w.zip","WebCodeObjectVersion":"wv"}}}
JSON

cat >"$W/env.json" <<'JSON'
{"schemaVersion":1,"region":"ap-south-1","stackPrefix":"automation-dev","parameters":{"web":{"ReservedConcurrency":3},"auth":{"UserPoolDomainPrefix":"automation-dev-test"},"runtime":{"EnvironmentName":"dev","AutomationTenantId":"tenant","StateTableName":"state","ArtifactBucketName":"artifacts","AgentCoreBrowserIdentifier":"AutomationBrowser-ABCDEF1234","AgentCoreBrowserResourceArn":"arn:aws:bedrock-agentcore:ap-south-1:123456789012:browser-custom/AutomationBrowser-ABCDEF1234","OpenAiByokModel":"gpt-5-mini"},"scheduling":{"EnvironmentName":"dev"},"controlPlaneService":{"EnvironmentName":"dev","StateTableName":"state","ArtifactBucketName":"artifacts","TenantId":"tenant"},"observability":{"EnvironmentName":"dev","SesFromIdentityArn":"arn:aws:ses:ap-south-1:123456789012:identity/example.test"}}}
JSON

result="$W/result.json"
bash "$ROOT_DIR/scripts/deploy-aws-release.sh" \
  --manifest "$W/release.json" \
  --environment "$W/env.json" \
  --output "$result" >/dev/null

python3 - "$result" "$AWS_LOG" <<'PY'
import json
import shlex
import sys

result = json.load(open(sys.argv[1]))
assert result['outputs']['webOrigin'] == 'https://web.lambda-url.ap-south-1.on.aws'
assert result['outputs']['agentCoreBrowserIdentifier'] == 'AutomationBrowser-ABCDEF1234'
assert result['outputs']['agentCoreBrowserArn'] == 'arn:aws:bedrock-agentcore:ap-south-1:123456789012:browser-custom/AutomationBrowser-ABCDEF1234'
assert result['stacks']['web'] == 'automation-dev-web'

calls = [shlex.split(line) for line in open(sys.argv[2])]
assert 'bedrock-agentcore-control' in calls[0]
assert 'get-browser' in calls[0]
assert calls[0][calls[0].index('--browser-id') + 1] == 'AutomationBrowser-ABCDEF1234'

deploys = [call for call in calls if 'cloudformation' in call and 'deploy' in call]
def value(call, option):
    return call[call.index(option) + 1]

assert [value(call, '--stack-name') for call in deploys] == [
    'automation-dev-web',
    'automation-dev-auth',
    'automation-dev-runtime',
    'automation-dev-scheduling',
    'automation-dev-control-plane',
    'automation-dev-auth',
    'automation-dev-web',
    'automation-dev-observability',
]
assert 'WebCallbackUrl=https://web.lambda-url.ap-south-1.on.aws/api/auth/callback' in deploys[1]
assert 'WebLogoutUrl=https://web.lambda-url.ap-south-1.on.aws/' in deploys[1]
assert 'ControlPlaneUrl=https://api.example' in deploys[6]
assert 'CognitoAppClientId=client' in deploys[6]
assert 'AgentCoreBrowserIdentifier=AutomationBrowser-ABCDEF1234' in deploys[4]
PY

# A VPC browser is a protected-deployment prerequisite. Public mode must fail
# before the first CloudFormation mutation.
: >"$AWS_LOG"
export FAKE_BROWSER_MODE=PUBLIC
if bash "$ROOT_DIR/scripts/deploy-aws-release.sh" \
  --manifest "$W/release.json" \
  --environment "$W/env.json" \
  --output "$W/public.json" >/dev/null 2>&1; then
  echo 'expected public browser deployment to fail' >&2
  exit 1
fi
unset FAKE_BROWSER_MODE
python3 - "$AWS_LOG" <<'PY'
import shlex
import sys
calls = [shlex.split(line) for line in open(sys.argv[1])]
assert len(calls) == 1
assert 'bedrock-agentcore-control' in calls[0]
assert not any('cloudformation' in call for call in calls)
PY

# The AWS-managed browser is rejected locally before any AWS call; production must
# opt into a deployment-owned custom Browser whose network configuration we can verify.
python3 - "$W/env.json" "$W/managed.json" <<'PY'
import json
import sys
x = json.load(open(sys.argv[1]))
x['parameters']['runtime']['AgentCoreBrowserIdentifier'] = 'aws.browser.v1'
x['parameters']['runtime']['AgentCoreBrowserResourceArn'] = 'arn:aws:bedrock-agentcore:ap-south-1:aws:browser/aws.browser.v1'
json.dump(x, open(sys.argv[2], 'w'))
PY
: >"$AWS_LOG"
if bash "$ROOT_DIR/scripts/deploy-aws-release.sh" \
  --manifest "$W/release.json" \
  --environment "$W/managed.json" \
  --output "$W/managed-result.json" >/dev/null 2>&1; then
  echo 'expected managed browser deployment to fail' >&2
  exit 1
fi
[[ ! -s "$AWS_LOG" ]]

# Browser identity for the control plane is derived from the verified runtime browser
# and cannot be independently overridden by environment configuration.
python3 - "$W/env.json" "$W/browser-override.json" <<'PY'
import json
import sys
x = json.load(open(sys.argv[1]))
x['parameters']['controlPlaneService']['AgentCoreBrowserIdentifier'] = 'OtherBrowser-ZYXWVUTSRQ'
json.dump(x, open(sys.argv[2], 'w'))
PY
: >"$AWS_LOG"
if bash "$ROOT_DIR/scripts/deploy-aws-release.sh" \
  --manifest "$W/release.json" \
  --environment "$W/browser-override.json" \
  --output "$W/browser-override-result.json" >/dev/null 2>&1; then
  echo 'expected derived browser override to fail' >&2
  exit 1
fi
[[ ! -s "$AWS_LOG" ]]

# Existing derived-value protection remains intact.
python3 - "$W/env.json" "$W/bad.json" <<'PY'
import json
import sys
x = json.load(open(sys.argv[1]))
x['parameters']['auth']['WebCallbackUrl'] = 'https://evil.example/cb'
json.dump(x, open(sys.argv[2], 'w'))
PY
: >"$AWS_LOG"
if bash "$ROOT_DIR/scripts/deploy-aws-release.sh" \
  --manifest "$W/release.json" \
  --environment "$W/bad.json" \
  --output "$W/no.json" >/dev/null 2>&1; then
  exit 1
fi
[[ ! -s "$AWS_LOG" ]]

echo 'deploy-aws-release tests passed'
