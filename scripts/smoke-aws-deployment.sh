#!/usr/bin/env bash
set -euo pipefail

deployment=""
environment=""
while (($#)); do
  case "$1" in
    --deployment) deployment="${2:-}"; shift 2 ;;
    --environment) environment="${2:-}"; shift 2 ;;
    -h|--help)
      echo 'Usage: smoke-aws-deployment.sh --deployment PATH [--environment PATH]'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$deployment" ]] || { echo 'valid --deployment is required' >&2; exit 2; }
if [[ -n "$environment" && ! -f "$environment" ]]; then
  echo 'valid --environment is required when supplied' >&2
  exit 2
fi
command -v python3 >/dev/null || { echo 'python3 is required' >&2; exit 2; }
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 2; }

meta="$(mktemp)"
tmp_dir="$(mktemp -d)"
trap 'rm -f "$meta"; rm -rf "$tmp_dir"' EXIT

python3 - "$deployment" "${environment:-}" >"$meta" <<'PY'
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

def parse_bool(raw, label):
    if raw in (True, "true"):
        return True
    if raw in (False, "false"):
        return False
    raise SystemExit(f"{label} must be true or false")

demo_enabled = None
demo_semantic_drift_enabled = None
if sys.argv[2]:
    env_doc = json.loads(Path(sys.argv[2]).read_text())
    if env_doc.get("schemaVersion") != 1:
        raise SystemExit("environment must use schemaVersion 1")
    parameters = env_doc.get("parameters")
    if not isinstance(parameters, dict):
        raise SystemExit("environment parameters are required")
    web = parameters.get("web")
    if not isinstance(web, dict):
        raise SystemExit("environment parameters.web is required")
    demo_enabled = parse_bool(
        web.get("DemoTargetEnabled", False),
        "parameters.web.DemoTargetEnabled",
    )
    demo_semantic_drift_enabled = parse_bool(
        web.get("DemoTargetSemanticDriftEnabled", False),
        "parameters.web.DemoTargetSemanticDriftEnabled",
    )

for name, value in required.items():
    print(f"{name}={shlex.quote(value.rstrip('/'))}")
if demo_enabled is not None:
    print(f"DEMO_TARGET_ENABLED={'true' if demo_enabled else 'false'}")
    print(
        "DEMO_TARGET_SEMANTIC_DRIFT_ENABLED="
        + ("true" if demo_semantic_drift_enabled else "false")
    )
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
grep -Fq 'href="/api/auth/sign-in?returnTo=/"' "$web_body" || { echo 'web smoke failed: signed-out authentication action is missing' >&2; exit 10; }
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

if [[ -n "${DEMO_TARGET_ENABLED:-}" ]]; then
  demo_body="$tmp_dir/demo.html"
  demo_code="$(curl "${curl_common[@]}" --output "$demo_body" --write-out '%{http_code}' "$WEB_ORIGIN/demo-target")"
  if [[ "$DEMO_TARGET_ENABLED" == true ]]; then
    [[ "$demo_code" == "401" ]] || { echo "demo-target smoke failed: enabled target expected 401 before sign-in, received $demo_code" >&2; exit 14; }
    grep -Fq 'data-testid="demo-login"' "$demo_body" || { echo 'demo-target smoke failed: enabled target login action is missing' >&2; exit 14; }

    demo_headers="$tmp_dir/demo-login.headers"
    demo_login_code="$(curl "${curl_common[@]}" --request POST --dump-header "$demo_headers" --output /dev/null --write-out '%{http_code}' "$WEB_ORIGIN/demo-target/login")"
    [[ "$demo_login_code" == "303" ]] || { echo "demo-target smoke failed: sign-in expected 303, received $demo_login_code" >&2; exit 14; }
    demo_cookie="$(python3 - "$demo_headers" "$WEB_ORIGIN" <<'PY'
import sys
from pathlib import Path

headers = Path(sys.argv[1]).read_text().splitlines()
def value(name):
    prefix = name.lower() + ':'
    return next((line.split(':', 1)[1].strip() for line in headers if line.lower().startswith(prefix)), None)

location = value('location')
if location != sys.argv[2].rstrip('/') + '/demo-target':
    raise SystemExit('demo-target smoke failed: sign-in redirect is not same-origin /demo-target')
cookie = value('set-cookie')
if not cookie or 'automation_demo_auth=authenticated' not in cookie:
    raise SystemExit('demo-target smoke failed: demo auth cookie is missing')
for required in ('Path=/demo-target', 'HttpOnly', 'Secure', 'SameSite=Lax'):
    if required not in cookie:
        raise SystemExit(f'demo-target smoke failed: cookie is missing {required}')
print(cookie.split(';', 1)[0])
PY
)"

    demo_workflow_body="$tmp_dir/demo-workflow.html"
    demo_workflow_code="$(curl "${curl_common[@]}" --header "Cookie: $demo_cookie" --output "$demo_workflow_body" --write-out '%{http_code}' "$WEB_ORIGIN/demo-target")"
    [[ "$demo_workflow_code" == "200" ]] || { echo "demo-target smoke failed: issued session cookie was not accepted; expected 200, received $demo_workflow_code" >&2; exit 14; }
    grep -Fq 'data-testid="demo-priority"' "$demo_workflow_body" || { echo 'demo-target smoke failed: authenticated workflow select control is missing' >&2; exit 14; }
    grep -Fq '<option value="high">High priority</option>' "$demo_workflow_body" || { echo 'demo-target smoke failed: expected controlled select option is missing' >&2; exit 14; }
    grep -Fq 'data-testid="demo-mode-focused"' "$demo_workflow_body" || { echo 'demo-target smoke failed: authenticated workflow radio target is missing' >&2; exit 14; }
    grep -Fq 'type="radio"' "$demo_workflow_body" || { echo 'demo-target smoke failed: demo handling mode is not a radio control' >&2; exit 14; }
    grep -Fq 'data-testid="demo-note"' "$demo_workflow_body" || { echo 'demo-target smoke failed: authenticated workflow note field is missing' >&2; exit 14; }
    grep -Fq 'data-testid="demo-confirm"' "$demo_workflow_body" || { echo 'demo-target smoke failed: authenticated workflow checkbox is missing' >&2; exit 14; }
    grep -Fq 'type="checkbox"' "$demo_workflow_body" || { echo 'demo-target smoke failed: demo confirmation is not a checkbox' >&2; exit 14; }
    if [[ "${DEMO_TARGET_SEMANTIC_DRIFT_ENABLED:-false}" == true ]]; then
      grep -Fq 'data-testid="demo-semantic-submit"' "$demo_workflow_body" || { echo 'demo-target smoke failed: semantic-drift submit action is missing' >&2; exit 14; }
      grep -Fq 'aria-label="Finish controlled demo after selector drift"' "$demo_workflow_body" || { echo 'demo-target smoke failed: semantic-drift accessible target is missing' >&2; exit 14; }
      if grep -Fq 'data-testid="demo-submit"' "$demo_workflow_body"; then
        echo 'demo-target smoke failed: semantic-drift deployment still exposes the captured submit target' >&2
        exit 14
      fi
    else
      grep -Fq 'data-testid="demo-submit"' "$demo_workflow_body" || { echo 'demo-target smoke failed: authenticated workflow submit action is missing' >&2; exit 14; }
      if grep -Fq 'data-testid="demo-semantic-submit"' "$demo_workflow_body"; then
        echo 'demo-target smoke failed: baseline deployment unexpectedly exposes semantic drift' >&2
        exit 14
      fi
    fi

    demo_action_body="$tmp_dir/demo-action.html"
    demo_action_code="$(curl "${curl_common[@]}" --request POST --header "Cookie: $demo_cookie" --header 'content-type: application/x-www-form-urlencoded' --data-urlencode 'priority=high' --data-urlencode 'mode=focused' --data-urlencode 'note=deployment-smoke-note' --data-urlencode 'confirm=confirmed' --output "$demo_action_body" --write-out '%{http_code}' "$WEB_ORIGIN/demo-target/action")"
    [[ "$demo_action_code" == "200" ]] || { echo "demo-target smoke failed: controlled workflow action expected 200, received $demo_action_code" >&2; exit 14; }
    grep -Fq 'data-testid="demo-complete"' "$demo_action_body" || { echo 'demo-target smoke failed: controlled workflow completion marker is missing' >&2; exit 14; }
    if grep -Fq 'deployment-smoke-note' "$demo_action_body" || grep -Fq 'High priority' "$demo_action_body" || grep -Fq 'focused' "$demo_action_body" || grep -Fq 'confirmed' "$demo_action_body"; then
      echo 'demo-target smoke failed: submitted workflow inputs were reflected into the response' >&2
      exit 14
    fi
  else
    [[ "$demo_code" == "404" ]] || { echo "demo-target smoke failed: disabled target expected 404, received $demo_code" >&2; exit 14; }
  fi
fi

echo "AWS deployment smoke passed: web configured, Cognito PKCE redirect valid, protected APIs reject anonymous access${DEMO_TARGET_ENABLED:+, demo-target state and action verified}."
