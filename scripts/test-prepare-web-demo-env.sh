#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat >"$tmp/deployment.json" <<'JSON'
{
  "schemaVersion": 1,
  "releaseId": "demo-release",
  "region": "us-east-1",
  "stackPrefix": "automation-demo",
  "stacks": {
    "auth": "automation-demo-auth",
    "agentCoreRuntime": "automation-demo-runtime",
    "scheduling": "automation-demo-scheduling",
    "controlPlaneService": "automation-demo-control-plane",
    "observability": null
  },
  "outputs": {
    "controlPlaneUrl": "https://api.example.test",
    "cognitoDomain": "https://login.example.test",
    "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/demo",
    "captureCompletionApiEndpoint": "https://capture.example.test",
    "captureCompletionInvokeArn": "arn:aws:execute-api:us-east-1:123456789012:api/*/POST/capture/complete"
  }
}
JSON

cat >"$tmp/bin/aws" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${FAKE_AWS_LOG:?}"
if [[ "$*" == *"cloudformation describe-stacks"*"CognitoAppClientId"* ]]; then
  printf '%s\n' 'client-123'
elif [[ "$*" == *"cloudformation describe-stacks"*"CognitoUserPoolId"* ]]; then
  printf '%s\n' 'us-east-1_pool123'
elif [[ "$*" == *"cognito-idp describe-user-pool-client"* ]]; then
  cat <<JSON
{
  "UserPoolClient": {
    "ClientId": "client-123",
    "AllowedOAuthFlowsUserPoolClient": true,
    "AllowedOAuthFlows": ["code"],
    "AllowedOAuthScopes": ["openid", "email", "profile"],
    "CallbackURLs": ["${FAKE_WEB_ORIGIN:?}/api/auth/callback"],
    "LogoutURLs": ["${FAKE_WEB_ORIGIN}/"]
  }
}
JSON
else
  echo "unexpected fake aws call: $*" >&2
  exit 91
fi
SH
chmod +x "$tmp/bin/aws"

export PATH="$tmp/bin:$PATH"
export FAKE_AWS_LOG="$tmp/aws.log"
export FAKE_WEB_ORIGIN="https://web.example.test"
output="$tmp/web.env"

bash "$ROOT_DIR/scripts/prepare-web-demo-env.sh" \
  --deployment "$tmp/deployment.json" \
  --origin "$FAKE_WEB_ORIGIN" \
  --output "$output"

grep -Fx 'AUTOMATION_CONTROL_PLANE_URL=https://api.example.test' "$output"
grep -Fx 'AUTOMATION_COGNITO_DOMAIN=https://login.example.test' "$output"
grep -Fx 'AWS_COGNITO_APP_CLIENT_ID=client-123' "$output"
grep -Fx 'AUTOMATION_WEB_ORIGIN=https://web.example.test' "$output"
! grep -Eqi 'access[_-]?key|secret[_-]?key|session[_-]?token|bearer|api[_-]?key' "$output"
grep -F -- '--region us-east-1 cloudformation describe-stacks --stack-name automation-demo-auth' "$FAKE_AWS_LOG"
grep -F -- 'cognito-idp describe-user-pool-client --user-pool-id us-east-1_pool123 --client-id client-123' "$FAKE_AWS_LOG"

# A mismatched callback origin must fail closed and must not leave an env file.
export FAKE_WEB_ORIGIN="https://other.example.test"
bad_output="$tmp/bad.env"
if bash "$ROOT_DIR/scripts/prepare-web-demo-env.sh" \
  --deployment "$tmp/deployment.json" \
  --origin 'https://web.example.test' \
  --output "$bad_output" >/dev/null 2>&1; then
  echo "expected Cognito callback mismatch to fail" >&2
  exit 1
fi
[[ ! -e "$bad_output" ]]

# Insecure/public-web origins are rejected before any additional AWS call.
count_before="$(wc -l <"$FAKE_AWS_LOG")"
if bash "$ROOT_DIR/scripts/prepare-web-demo-env.sh" \
  --deployment "$tmp/deployment.json" \
  --origin 'http://web.example.test' \
  --output "$tmp/insecure.env" >/dev/null 2>&1; then
  echo "expected insecure web origin to fail" >&2
  exit 1
fi
count_after="$(wc -l <"$FAKE_AWS_LOG")"
[[ "$count_before" == "$count_after" ]]
[[ ! -e "$tmp/insecure.env" ]]

printf '%s\n' 'AWS web demo environment contract passed'
