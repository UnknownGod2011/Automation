#!/usr/bin/env bash
set -euo pipefail

deployment=""
while (($#)); do
  case "$1" in
    --deployment) deployment="${2:-}"; shift 2 ;;
    -h|--help)
      echo 'Usage: smoke-aws-deployment.sh --deployment PATH'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$deployment" ]] || { echo 'valid --deployment is required' >&2; exit 2; }
command -v python3 >/dev/null || { echo 'python3 is required' >&2; exit 2; }
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 2; }

meta="$(mktemp)"
tmp_dir="$(mktemp -d)"
trap 'rm -f "$meta"; rm -rf "$tmp_dir"' EXIT

python3 - "$deployment" >"$meta" <<'PY'
import json
import shlex
import sys
from pathlib import Path
from urllib.parse import urlparse

doc = json.loads(Path(sys.argv[1]).read_text())
if doc.get("schemaVersion") != 1:
    raise SystemExit("deployment must use schemaVersion 1")
outputs = doc.get("outputs")
if not isinstance(outputs, dict):
    raise SystemExit("deployment outputs are required")

required = {
    "WEB_ORIGIN": outputs.get("webOrigin"),
    "CONTROL_PLANE_URL": outputs.get("controlPlaneUrl"),
    "COGNITO_DOMAIN": outputs.get("cognitoDomain"),
    "CAPTURE_COMPLETION_URL": outputs.get("captureCompletionApiEndpoint"),
}
for name, value in required.items():
    if not isinstance(value, str) or not value:
        raise SystemExit(f"missing deployment output for {name}")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
        raise SystemExit(f"unsafe deployment URL for {name}")
    if name == "WEB_ORIGIN" and (parsed.path not in ("", "/") or parsed.query):
        raise SystemExit("webOrigin must be an HTTPS origin without path/query")

for name, value in required.items():
    print(f"{name}={shlex.quote(value.rstrip('/'))}")
PY
# shellcheck disable=SC1090
source "$meta"

curl_common=(
  --silent
  --show-error
  --connect-timeout "${AUTOMATION_SMOKE_CONNECT_TIMEOUT_SECONDS:-5}"
  --max-time "${AUTOMATION_SMOKE_MAX_TIME_SECONDS:-15}"
  --proto '=https'
  --proto-redir '=https'
)

web_body="$tmp_dir/web.html"
web_code="$(curl "${curl_common[@]}" --output "$web_body" --write-out '%{http_code}' "$WEB_ORIGIN/")"
[[ "$web_code" == "200" ]] || { echo "web smoke failed: expected 200, received $web_code" >&2; exit 10; }
grep -Fq 'Teach it once. Let the cloud run it.' "$web_body" || { echo 'web smoke failed: expected product shell was not rendered' >&2; exit 10; }
grep -Fq 'Sign in with Cognito' "$web_body" || { echo 'web smoke failed: signed-out Cognito action is missing' >&2; exit 10; }
if grep -Fq 'Authentication is not configured for this deployment' "$web_body" || grep -Fq 'The authenticated control-plane URL is not configured' "$web_body"; then
  echo 'web smoke failed: deployment is still in NOT_CONFIGURED bootstrap state' >&2
  exit 10
fi

auth_headers="$tmp_dir/auth.headers"
auth_code="$(curl "${curl_common[@]}" --dump-header "$auth_headers" --output /dev/null --write-out '%{http_code}' "$WEB_ORIGIN/api/auth/sign-in?returnTo=/")"
case "$auth_code" in
  302|303|307|308) ;;
  *) echo "auth smoke failed: expected redirect, received $auth_code" >&2; exit 11 ;;
esac
python3 - "$auth_headers" "$WEB_ORIGIN" "$COGNITO_DOMAIN" <<'PY'
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

headers = Path(sys.argv[1]).read_text().splitlines()
location = next((line.split(":", 1)[1].strip() for line in headers if line.lower().startswith("location:")), None)
if not location:
    raise SystemExit("auth smoke failed: redirect Location is missing")
web_origin = sys.argv[2].rstrip("/")
expected_domain = urlparse(sys.argv[3]).netloc
redirect = urlparse(location)
if redirect.scheme != "https" or redirect.netloc != expected_domain or redirect.username or redirect.password:
    raise SystemExit("auth smoke failed: redirect does not target deployed Cognito domain")
query = parse_qs(redirect.query)
if query.get("response_type") != ["code"]:
    raise SystemExit("auth smoke failed: authorization-code flow is missing")
if query.get("code_challenge_method") != ["S256"] or not query.get("code_challenge", [""])[0]:
    raise SystemExit("auth smoke failed: PKCE S256 is missing")
if query.get("redirect_uri") != [f"{web_origin}/api/auth/callback"]:
    raise SystemExit("auth smoke failed: callback URL does not match deployed web origin")
scopes = set(query.get("scope", [""])[0].split())
if not {"openid", "email", "profile"}.issubset(scopes):
    raise SystemExit("auth smoke failed: required OAuth scopes are missing")
if not query.get("client_id", [""])[0] or not query.get("state", [""])[0]:
    raise SystemExit("auth smoke failed: client/state binding is missing")
PY

control_code="$(curl "${curl_common[@]}" --output /dev/null --write-out '%{http_code}' "$CONTROL_PLANE_URL/v1/automations")"
case "$control_code" in
  401|403) ;;
  *) echo "control-plane auth smoke failed: anonymous request returned $control_code" >&2; exit 12 ;;
esac

capture_code="$(curl "${curl_common[@]}" --request POST --header 'content-type: application/json' --data '{}' --output /dev/null --write-out '%{http_code}' "$CAPTURE_COMPLETION_URL/capture/complete")"
case "$capture_code" in
  401|403) ;;
  *) echo "capture-completion auth smoke failed: anonymous request returned $capture_code" >&2; exit 13 ;;
esac

echo 'AWS deployment smoke passed: web configured, Cognito PKCE redirect valid, protected APIs reject anonymous access.'
