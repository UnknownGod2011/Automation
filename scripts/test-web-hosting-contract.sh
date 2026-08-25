#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
t="$ROOT_DIR/infra/aws/web-app.yaml"
grep -q 'LambdaAdapterLayerX86:28' "$t"
grep -q 'Action: lambda:InvokeFunctionUrl' "$t"
grep -q 'Action: lambda:InvokeFunction' "$t"
grep -q 'InvokedViaFunctionUrl: true' "$t"
grep -q 'ReservedConcurrentExecutions:' "$t"
grep -q 'LoggingConfig:' "$t"
grep -A3 -q '^  DemoTargetEnabled:' "$t"
grep -A3 '^  DemoTargetEnabled:' "$t" | grep -q "Default: 'false'"
grep -q 'AUTOMATION_DEMO_TARGET_ENABLED: !Ref DemoTargetEnabled' "$t"
grep -q 'AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS: !Ref DemoTargetSessionTtlSeconds' "$t"
for forbidden in 'dynamodb:' 's3:' 'bedrock-agentcore:' 'ses:' 'states:' 'scheduler:'; do
  if grep -q "$forbidden" "$t"; then echo "web hosting template unexpectedly grants $forbidden" >&2; exit 1; fi
done
printf 'web hosting contract tests passed\n'
