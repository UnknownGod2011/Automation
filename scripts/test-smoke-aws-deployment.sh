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

cat >"$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
out=""; headers=""; write=""; url=""; method="GET"
while (($#)); do
  case "$1" in
    --output|-o) out="$2"; shift 2 ;;
    --dump-header|-D) headers="$2"; shift 2 ;;
    --write-out|-w) write="$2"; shift 2 ;;
    --request|-X) method="$2"; shift 2 ;;
    --connect-timeout|--max-time|--proto|--proto-redir|--header|--data) shift 2 ;;
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
fi
if [[ "$write" == *'%{http_code}'* ]]; then printf '%s' "$code"; fi
SH
chmod +x "$tmp/bin/curl"

PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" >"$tmp/good.out"
grep -Fq 'AWS deployment smoke passed' "$tmp/good.out"

if FAKE_AUTH_MODE=bad PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/deployment.json" >"$tmp/bad.out" 2>"$tmp/bad.err"; then
  echo 'smoke contract should reject non-S256 Cognito redirects' >&2
  exit 1
fi
grep -Fq 'PKCE S256 is missing' "$tmp/bad.err"

python3 - "$tmp/deployment.json" >"$tmp/unsafe.json" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); doc=json.loads(p.read_text()); doc['outputs']['webOrigin']='http://web.example.com'; print(json.dumps(doc))
PY
if PATH="$tmp/bin:$PATH" bash "$ROOT_DIR/scripts/smoke-aws-deployment.sh" --deployment "$tmp/unsafe.json" >"$tmp/unsafe.out" 2>"$tmp/unsafe.err"; then
  echo 'smoke contract should reject insecure deployment origins' >&2
  exit 1
fi
grep -Fq 'unsafe deployment URL for WEB_ORIGIN' "$tmp/unsafe.err"

echo 'AWS deployment smoke contract passed'
