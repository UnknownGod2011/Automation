#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat >"$tmp/deployment.json" <<'JSON'
{
  "schemaVersion": 1,
  "releaseId": "test-release",
  "outputs": {
    "webOrigin": "https://web.example.com",
    "controlPlaneUrl": "https://api.example.com",
    "cognitoDomain": "https://auth.example.com",
    "captureCompletionApiEndpoint": "https://capture.example.com"
  }
}
JSON
cat >"$tmp/environment.json" <<'JSON'
{"schemaVersion":1,"parameters":{"web":{"DemoTargetEnabled":"true"}}}
JSON

cat >"$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
out=""; headers=""; write=""; url=""; method="GET"; cookie=""; encoded_data=""
while (($#)); do
  case "$1" in
    --output|-o) out="$2"; shift 2 ;;
    --dump-header|-D) headers="$2"; shift 2 ;;
    --write-out|-w) write="$2"; shift 2 ;;
    --request|-X) method="$2"; shift 2 ;;
    --header)
      if [[ "$2" == Cookie:* ]]; then cookie="$2"; fi
      shift 2
      ;;
    --data-urlencode) encoded_data="$2"; shift 2 ;;
    --connect-timeout|--max-time|--proto|--proto-redir|--data) shift 2 ;;
    --silent|--show-error) shift ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
code=500
if [[ "$url" == "https://web.example.com/" ]]; then
  code=200
  [[ "$out" == /dev/null ]] || cat >"$out" <<'HTML'
<html><body><h1>Teach it once. Let the cloud run it.</h1><a>Sign in with Cognito</a></body></html>
HTML
elif [[ "$url" == "https://web.example.com/api/auth/sign-in?returnTo=/" ]]; then
  code=307
  if [[ -n "$headers" ]]; then
    if [[ "${FAKE_AUTH_MODE:-good}" == "good" ]]; then
      printf 'HTTP/1.1 307 Temporary Redirect\r\nLocation: https://auth.example.com/oauth2/authorize?response_type=code&client_id=client123&redirect_uri=https%%3A%%2F%%2Fweb.example.com%%2Fapi%%2Fauth%%2Fcallback&scope=openid%%20email%%20profile&state=state123&code_challenge=challenge123&code_challenge_method=S256\r\n\r\n' >"$headers"
    else
      printf 'HTTP/1.1 307 Temporary Redirect\r\nLocation: https://auth.example.com/oauth2/authorize?response_type=code&client_id=client123&redirect_uri=https%%3A%%2F%%2Fweb.example.com%%2Fapi%%2Fauth%%2Fcallback&scope=openid%%20email%%20profile&state=state123&code_challenge=challenge123&code_challenge_method=plain\r\n\r\n' >"$headers"
    fi
  fi
elif [[ "$url" == "https://api.example.com/v1/automations" ]]; then
  code=401
elif [[ "$url" == "https://capture.example.com/capture/complete" && "$method" == "POST" ]]; then
  code=403
elif [[ "$url" == "https://web.example.com/demo-target" ]]; then
  if [[ "${FAKE_DEMO_MODE:-good}" == "disabled" ]]; then
    code=404
  elif [[ "$cookie" == "Cookie: automation_demo_auth=authenticated" && "${FAKE_DEMO_MODE:-good}" != "session-broken" ]]; then
    code=200
    [[ "$out" == /dev/null ]] || printf '<html><textarea data-testid="demo-note"></textarea><button data-testid="demo-submit">Complete</button></html>' >"$out"
  else
    code=401
    [[ "$out" == /dev/null ]] || printf '<html><button data-testid="demo-login">Sign in</button></html>' >"$out"
  fi
elif [[ "$url" == "https://web.example.com/demo-target/login" && "$method" == "POST" ]]; then
  code=303
  if [[ -n "$headers" ]]; then
    printf 'HTTP/1.1 303 See Other\r\nLocation: https://web.example.com/demo-target\r\nSet-Cookie: automation_demo_auth=authenticated; Path=/demo-target; Max-Age=900; HttpOnly; Secure; SameSite=Lax\r\n\r\n' >"$headers"
  fi
elif [[ "$url" == "https://web.example.com/demo-target/action" && "$method" == "POST" ]]; then
  if [[ "$cookie" != "Cookie: automation_demo_auth=authenticated" ]]; then
    code=401
  elif [[ "${FAKE_DEMO_MODE:-good}" == "action-broken" ]]; then
    code=500
  else
    code=200
    if [[ "$out" != /dev/null ]]; then
      if [[ "${FAKE_DEMO_MODE:-good}" == "reflect-note" ]]; then
        printf '<html><div data-testid="demo-complete">deployment-smoke-note</div></html>' >"$out"
      else
        printf '<html><div data-testid="demo-complete">Demo task completed.</div></html>' >"$out"
      fi
    fi
    [[ "$encoded_data" == "note=deployment-smoke-note" ]] || code=400
  fi
fi
if [[ "$write" == *'%{http_code}'* ]]; then printf '%s' "$code"; fi
SH
chmod +x "$tmp/bin/curl"

PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" --environment "$tmp/environment.json" >"$tmp/good.out"
grep -Fq 'demo-target state and action verified' "$tmp/good.out"

if FAKE_AUTH_MODE=bad PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" --environment "$tmp/environment.json" >"$tmp/bad.out" 2>"$tmp/bad.err"; then
  echo 'smoke contract should reject non-S256 Cognito redirects' >&2
  exit 1
fi
grep -Fq 'PKCE S256 is missing' "$tmp/bad.err"

python3 - "$tmp/deployment.json" >"$tmp/unsafe.json" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); doc=json.loads(p.read_text()); doc['outputs']['webOrigin']='http://web.example.com'; print(json.dumps(doc))
PY
if PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/unsafe.json" --environment "$tmp/environment.json" >"$tmp/unsafe.out" 2>"$tmp/unsafe.err"; then
  echo 'smoke contract should reject insecure deployment origins' >&2
  exit 1
fi
grep -Fq 'unsafe deployment URL for WEB_ORIGIN' "$tmp/unsafe.err"

if FAKE_DEMO_MODE=disabled PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" --environment "$tmp/environment.json" >"$tmp/demo-mismatch.out" 2>"$tmp/demo-mismatch.err"; then
  echo 'smoke contract should reject an enabled demo target that is not live' >&2
  exit 1
fi
grep -Fq 'enabled target expected 401' "$tmp/demo-mismatch.err"

if FAKE_DEMO_MODE=session-broken PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" --environment "$tmp/environment.json" >"$tmp/demo-session.out" 2>"$tmp/demo-session.err"; then
  echo 'smoke contract should reject a demo cookie that the deployed target does not accept' >&2
  exit 1
fi
grep -Fq 'issued session cookie was not accepted' "$tmp/demo-session.err"

if FAKE_DEMO_MODE=action-broken PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" --environment "$tmp/environment.json" >"$tmp/demo-action.out" 2>"$tmp/demo-action.err"; then
  echo 'smoke contract should reject a broken controlled demo action' >&2
  exit 1
fi
grep -Fq 'controlled workflow action expected 200' "$tmp/demo-action.err"

if FAKE_DEMO_MODE=reflect-note PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" --environment "$tmp/environment.json" >"$tmp/demo-reflect.out" 2>"$tmp/demo-reflect.err"; then
  echo 'smoke contract should reject demo responses that reflect the submitted note' >&2
  exit 1
fi
grep -Fq 'submitted note was reflected' "$tmp/demo-reflect.err"

python3 - "$tmp/environment.json" >"$tmp/demo-disabled.json" <<'PY'
import json,sys
from pathlib import Path
doc=json.loads(Path(sys.argv[1]).read_text()); doc['parameters']['web']['DemoTargetEnabled']='false'; print(json.dumps(doc))
PY
FAKE_DEMO_MODE=disabled PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" --environment "$tmp/demo-disabled.json" >"$tmp/demo-disabled.out"
grep -Fq 'demo-target state and action verified' "$tmp/demo-disabled.out"

echo 'AWS deployment smoke contract passed'
