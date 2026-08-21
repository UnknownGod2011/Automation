#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: prepare-web-demo-env.sh --deployment PATH --origin HTTPS_URL [--output PATH]

Builds the non-secret server environment required by apps/web from an AWS
deployment result. The command also verifies that the deployed Cognito app
client is configured for authorization-code + PKCE at the requested web origin.

The AWS CLI credential provider chain is used. This command never accepts or
writes AWS access keys, Cognito tokens, provider API keys, or browser secrets.
EOF
}

deployment=""
origin=""
output=""
while (($#)); do
  case "$1" in
    --deployment) deployment="${2:-}"; shift 2 ;;
    --origin) origin="${2:-}"; shift 2 ;;
    --output) output="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$deployment" && -f "$deployment" ]] || { echo "valid --deployment is required" >&2; exit 2; }
[[ -n "$origin" ]] || { echo "--origin is required" >&2; exit 2; }
command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
export AWS_PAGER=""
umask 077

meta_file="$(mktemp)"
client_file="$(mktemp)"
trap 'rm -f "$meta_file" "$client_file"' EXIT

python3 - "$deployment" "$origin" >"$meta_file" <<'PY'
import json, re, sys
from pathlib import Path
from urllib.parse import urlparse

d = json.loads(Path(sys.argv[1]).read_text())
origin = sys.argv[2].strip()
if d.get("schemaVersion") != 1:
    raise SystemExit("unsupported deployment result schemaVersion")
region = d.get("region")
auth_stack = (d.get("stacks") or {}).get("auth")
outputs = d.get("outputs") or {}
control = outputs.get("controlPlaneUrl")
domain = outputs.get("cognitoDomain")
if not isinstance(region, str) or not re.fullmatch(r"[a-z]{2}(?:-gov)?-[a-z]+-\d", region):
    raise SystemExit("deployment result has invalid region")
if not isinstance(auth_stack, str) or not auth_stack:
    raise SystemExit("deployment result is missing auth stack")

def safe_https(value, name):
    if not isinstance(value, str): raise SystemExit(f"{name} is missing")
    p=urlparse(value)
    if p.scheme != "https" or not p.netloc or p.username or p.password or p.query or p.fragment:
        raise SystemExit(f"{name} must be a credential-free HTTPS URL")
    return value.rstrip("/")
control=safe_https(control,"controlPlaneUrl")
domain=safe_https(domain,"cognitoDomain")
web=safe_https(origin,"web origin")
p=urlparse(web)
if p.path not in ("", "/"):
    raise SystemExit("web origin must not include a path")
for value in (auth_stack, control, domain, web):
    if any(c in value for c in ("\n","\r","\t","\x00")):
        raise SystemExit("deployment metadata contains unsupported control characters")
print("\t".join((region,auth_stack,control,domain,web)))
PY

IFS=$'\t' read -r region auth_stack control_plane_url cognito_domain web_origin <"$meta_file"
[[ -n "$region" && -n "$auth_stack" && -n "$control_plane_url" && -n "$cognito_domain" && -n "$web_origin" ]] || exit 2
aws_args=(--region "$region")

stack_output() {
  local value
  value="$(aws "${aws_args[@]}" cloudformation describe-stacks --stack-name "$auth_stack" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text)"
  [[ -n "$value" && "$value" != None && "$value" != null ]] || { echo "missing CloudFormation output $1 from $auth_stack" >&2; exit 6; }
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *$'\t'* ]] || { echo "invalid control character in CloudFormation output $1" >&2; exit 6; }
  printf '%s' "$value"
}

client_id="$(stack_output CognitoAppClientId)"
user_pool_id="$(stack_output CognitoUserPoolId)"
aws "${aws_args[@]}" cognito-idp describe-user-pool-client \
  --user-pool-id "$user_pool_id" \
  --client-id "$client_id" \
  --output json >"$client_file"

python3 - "$client_file" "$web_origin" <<'PY'
import json, sys
from pathlib import Path
p=json.loads(Path(sys.argv[1]).read_text()).get("UserPoolClient") or {}
origin=sys.argv[2].rstrip("/")
callbacks=set(p.get("CallbackURLs") or [])
logouts=set(p.get("LogoutURLs") or [])
flows=set(p.get("AllowedOAuthFlows") or [])
scopes=set(p.get("AllowedOAuthScopes") or [])
if p.get("AllowedOAuthFlowsUserPoolClient") is not True:
    raise SystemExit("Cognito app client OAuth flows are not enabled")
if "code" not in flows:
    raise SystemExit("Cognito app client must allow authorization-code flow")
required={"openid","email","profile"}
if not required.issubset(scopes):
    raise SystemExit("Cognito app client is missing required openid/email/profile scopes")
callback=f"{origin}/api/auth/callback"
logout=f"{origin}/"
if callback not in callbacks:
    raise SystemExit(f"Cognito callback URL is not configured for {callback}")
if logout not in logouts:
    raise SystemExit(f"Cognito logout URL is not configured for {logout}")
PY

[[ -n "$output" ]] || output=".env.aws-demo.local"
mkdir -p "$(dirname "$output")"
tmp_output="$output.tmp"
cat >"$tmp_output" <<EOF
# Generated from immutable AWS deployment outputs. Contains no credentials.
AUTOMATION_CONTROL_PLANE_URL=$control_plane_url
AUTOMATION_COGNITO_DOMAIN=$cognito_domain
AWS_COGNITO_APP_CLIENT_ID=$client_id
AUTOMATION_WEB_ORIGIN=$web_origin
EOF
mv "$tmp_output" "$output"
chmod 600 "$output" 2>/dev/null || true
printf 'Web demo environment: %s\n' "$output"
