#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: verify-google-demo-user.sh --deployment PATH --email ADDRESS

Verifies that one real Google-federated Cognito user created by the deployed
stack has the expected email and email_verified=true before SES notification
evidence is trusted for the vertical demo.

The AWS CLI credential provider chain is used. This command never accepts or
prints Cognito tokens, Google tokens, provider API keys, browser secrets, or
Cognito user subject identifiers.
EOF
}

deployment=""
email=""
while (($#)); do
  case "$1" in
    --deployment) deployment="${2:-}"; shift 2 ;;
    --email) email="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$deployment" && -f "$deployment" ]] || { echo "valid --deployment is required" >&2; exit 2; }
[[ -n "$email" ]] || { echo "--email is required" >&2; exit 2; }
command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
export AWS_PAGER=""

meta_file="$(mktemp)"
users_file="$(mktemp)"
trap 'rm -f "$meta_file" "$users_file"' EXIT

python3 - "$deployment" "$email" >"$meta_file" <<'PY'
import json, re, sys
from pathlib import Path

deployment = json.loads(Path(sys.argv[1]).read_text())
email = sys.argv[2]
if deployment.get("schemaVersion") != 1:
    raise SystemExit("unsupported deployment result schemaVersion")
region = deployment.get("region")
auth_stack = (deployment.get("stacks") or {}).get("auth")
if not isinstance(region, str) or not re.fullmatch(r"[a-z]{2}(?:-gov)?-[a-z]+-\d", region):
    raise SystemExit("deployment result has invalid region")
if not isinstance(auth_stack, str) or not auth_stack or any(c in auth_stack for c in "\r\n\t\x00"):
    raise SystemExit("deployment result is missing a valid auth stack")
if len(email) > 320 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}", email):
    raise SystemExit("--email must be a bounded plain email address")
print(f"{region}\t{auth_stack}")
PY

IFS=$'\t' read -r region auth_stack <"$meta_file"
[[ -n "$region" && -n "$auth_stack" ]] || exit 2

user_pool_id="$(aws --region "$region" cloudformation describe-stacks \
  --stack-name "$auth_stack" \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue | [0]" \
  --output text)"
[[ -n "$user_pool_id" && "$user_pool_id" != None && "$user_pool_id" != null ]] || {
  echo "missing CognitoUserPoolId from deployed auth stack" >&2
  exit 6
}
[[ "$user_pool_id" != *$'\n'* && "$user_pool_id" != *$'\r'* && "$user_pool_id" != *$'\t'* ]] || {
  echo "invalid CognitoUserPoolId returned by deployment" >&2
  exit 6
}

aws --region "$region" cognito-idp list-users \
  --user-pool-id "$user_pool_id" \
  --filter "email = \"$email\"" \
  --limit 2 \
  --output json >"$users_file"

python3 - "$users_file" "$email" <<'PY'
import json, sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
expected_email = sys.argv[2]
users = payload.get("Users")
if not isinstance(users, list) or len(users) != 1:
    raise SystemExit("expected exactly one Cognito user for the demo email")
user = users[0]
if user.get("Enabled") is not True:
    raise SystemExit("demo Cognito user is disabled")
attrs = user.get("Attributes")
if not isinstance(attrs, list):
    raise SystemExit("demo Cognito user attributes are missing")
values = {}
for item in attrs:
    if isinstance(item, dict) and isinstance(item.get("Name"), str) and isinstance(item.get("Value"), str):
        values[item["Name"]] = item["Value"]
if values.get("email") != expected_email:
    raise SystemExit("Cognito email does not match the requested demo user")
if values.get("email_verified", "").lower() != "true":
    raise SystemExit("Google-federated Cognito email is not verified")
try:
    identities = json.loads(values.get("identities", "[]"))
except json.JSONDecodeError as exc:
    raise SystemExit("Cognito federated identities attribute is malformed") from exc
if not isinstance(identities, list) or not any(
    isinstance(identity, dict) and identity.get("providerName") == "Google"
    for identity in identities
):
    raise SystemExit("demo Cognito user is not linked to the Google identity provider")
PY

printf '%s\n' 'Verified Google-federated Cognito user for trusted notification evidence.'
