#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; mkdir -p "$W/bin"; AWS_LOG="$W/aws.log"
cat >"$W/bin/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >>"$AWS_LOG"; printf '\n' >>"$AWS_LOG"; [[ " $* " == *' cloudformation deploy '* ]] && exit 0
if [[ " $* " == *' cloudformation describe-stacks '* ]]; then q=""; while (($#)); do [[ "$1" == --query ]] && { q="$2";break; };shift;done; case "$q" in *WebOrigin*) echo 'https://web.lambda-url.ap-south-1.on.aws/';; *CognitoIssuer*) echo 'https://cognito-idp.ap-south-1.amazonaws.com/pool';; *CognitoAppClientId*) echo client;; *CognitoUserPoolId*) echo pool;; *AgentRuntimeExecutionRoleArn*) echo 'arn:aws:iam::123456789012:role/runtime-role';; *AgentRuntimeArn*) echo 'arn:aws:bedrock-agentcore:ap-south-1:123456789012:runtime/r';; *DispatchQueueArn*) echo 'arn:aws:sqs:ap-south-1:123456789012:q';; *DispatchDeadLetterQueueArn*) echo 'arn:aws:sqs:ap-south-1:123456789012:dlq';; *SchedulerTargetRoleArn*) echo 'arn:aws:iam::123456789012:role/scheduler';; *SchedulerGroupName*) echo group;; *ScheduledRunStateMachineArn*) echo 'arn:aws:states:ap-south-1:123456789012:stateMachine:sm';; *ControlPlaneLambdaArn*) echo 'arn:aws:lambda:ap-south-1:123456789012:function:cp';; *CaptureCompletionApiEndpoint*) echo 'https://capture.example/capture/complete';; *CaptureCompletionInvokeArn*) echo 'arn:aws:execute-api:ap-south-1:123456789012:c/*';; *ControlPlaneUrl*) echo 'https://api.example';; *CognitoDomain*) echo 'https://login.auth.ap-south-1.amazoncognito.com';; *) exit 94;; esac; exit 0; fi
exit 93
AWS
chmod +x "$W/bin/aws"; export PATH="$W/bin:$PATH" AWS_LOG
cat >"$W/release.json" <<'JSON'
{"schemaVersion":1,"releaseId":"abc123","region":"ap-south-1","artifacts":{"agentCoreRuntime":{"key":"r.zip","versionId":"rv","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"controlPlaneLambda":{"key":"c.zip","versionId":"cv","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"webLambda":{"key":"w.zip","versionId":"wv","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}},"cloudFormationParameters":{"agentCoreRuntime":{"RuntimeCodeBucket":"release","RuntimeCodePrefix":"r.zip","RuntimeCodeVersionId":"rv"},"controlPlaneService":{"CodeBucketName":"release","CodeObjectKey":"c.zip","CodeObjectVersion":"cv"},"webApp":{"WebCodeBucket":"release","WebCodeObjectKey":"w.zip","WebCodeObjectVersion":"wv"}}}
JSON
cat >"$W/env.json" <<'JSON'
{"schemaVersion":1,"region":"ap-south-1","stackPrefix":"automation-dev","parameters":{"web":{"ReservedConcurrency":3},"auth":{"UserPoolDomainPrefix":"automation-dev-test"},"runtime":{"EnvironmentName":"dev","AutomationTenantId":"tenant","StateTableName":"state","ArtifactBucketName":"artifacts","AgentCoreBrowserResourceArn":"arn:aws:bedrock-agentcore:ap-south-1:123456789012:browser/b","OpenAiByokModel":"gpt-5-mini"},"scheduling":{"EnvironmentName":"dev"},"controlPlaneService":{"EnvironmentName":"dev","StateTableName":"state","ArtifactBucketName":"artifacts","TenantId":"tenant"},"observability":{"EnvironmentName":"dev","SesFromIdentityArn":"arn:aws:ses:ap-south-1:123456789012:identity/example.test"}}}
JSON
result="$W/result.json"; bash "$ROOT_DIR/scripts/deploy-aws-release.sh" --manifest "$W/release.json" --environment "$W/env.json" --output "$result" >/dev/null
python3 - "$result" "$AWS_LOG" <<'PY'
import json,shlex,sys
r=json.load(open(sys.argv[1])); assert r['outputs']['webOrigin']=='https://web.lambda-url.ap-south-1.on.aws'; assert r['stacks']['web']=='automation-dev-web'
cs=[shlex.split(x) for x in open(sys.argv[2])]; ds=[c for c in cs if 'cloudformation' in c and 'deploy' in c]
def v(c,x):return c[c.index(x)+1]
assert [v(c,'--stack-name') for c in ds]==['automation-dev-web','automation-dev-auth','automation-dev-runtime','automation-dev-scheduling','automation-dev-control-plane','automation-dev-auth','automation-dev-web','automation-dev-observability']
assert 'WebCallbackUrl=https://web.lambda-url.ap-south-1.on.aws/api/auth/callback' in ds[1]
assert 'WebLogoutUrl=https://web.lambda-url.ap-south-1.on.aws/' in ds[1]
assert 'ControlPlaneUrl=https://api.example' in ds[6] and 'CognitoAppClientId=client' in ds[6]
PY
python3 - "$W/env.json" "$W/bad.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));x['parameters']['auth']['WebCallbackUrl']='https://evil.example/cb';json.dump(x,open(sys.argv[2],'w'))
PY
: >"$AWS_LOG"; if bash "$ROOT_DIR/scripts/deploy-aws-release.sh" --manifest "$W/release.json" --environment "$W/bad.json" --output "$W/no.json" >/dev/null 2>&1; then exit 1; fi; [[ ! -s "$AWS_LOG" ]]
echo 'deploy-aws-release tests passed'
