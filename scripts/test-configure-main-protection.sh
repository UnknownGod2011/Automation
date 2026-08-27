#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT}/scripts/configure-main-protection.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat > "$TMP/bin/gh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${FAKE_GH_STATE_DIR:?}"
mode="${FAKE_GH_MODE:-unprotected}"
printf '%s\n' "$*" >> "$state_dir/calls.log"
endpoint="${!#}"

if [[ "$*" == *"--method PUT"* ]]; then
  cat > "$state_dir/payload.json"
  : > "$state_dir/applied"
  printf '{"url":"https://api.github.test/protection"}'
  exit 0
fi

applied=false
[[ -f "$state_dir/applied" ]] && applied=true
case "$endpoint" in
  repos/UnknownGod2011/Automation/branches/main)
    if [[ "$applied" == true || "$mode" == protected-good || "$mode" == protected-incomplete ]]; then
      printf '{"protected":true,"commit":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'
    else
      printf '{"protected":false,"commit":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'
    fi
    ;;
  repos/UnknownGod2011/Automation/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs\?per_page=100)
    if [[ "$mode" == missing-check ]]; then
      printf '{"total_count":0,"check_runs":[]}'
    else
      printf '{"total_count":1,"check_runs":[{"name":"validate","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","app":{"id":15368}}]}'
    fi
    ;;
  repos/UnknownGod2011/Automation/branches/main/protection)
    if [[ "$mode" == protected-incomplete && "$applied" == false ]]; then
      printf '{"required_status_checks":null,"enforce_admins":{"enabled":false},"required_pull_request_reviews":null,"required_conversation_resolution":{"enabled":false},"allow_force_pushes":{"enabled":false},"allow_deletions":{"enabled":false}}'
    else
      printf '{"required_status_checks":{"strict":true,"checks":[{"context":"validate","app_id":15368}]},"enforce_admins":{"enabled":true},"required_pull_request_reviews":{"required_approving_review_count":0},"required_conversation_resolution":{"enabled":true},"allow_force_pushes":{"enabled":false},"allow_deletions":{"enabled":false}}'
    fi
    ;;
  *)
    echo "unexpected fake gh endpoint: $endpoint" >&2
    exit 91
    ;;
esac
FAKE
chmod +x "$TMP/bin/gh"

new_state() {
  local name="$1"
  mkdir -p "$TMP/$name"
  : > "$TMP/$name/calls.log"
  printf '%s' "$TMP/$name"
}

run_script() {
  local state="$1"
  local mode="$2"
  shift 2
  PATH="$TMP/bin:$PATH" FAKE_GH_STATE_DIR="$state" FAKE_GH_MODE="$mode" \
    bash "$SCRIPT" --repository UnknownGod2011/Automation "$@"
}

state="$(new_state apply)"
run_script "$state" unprotected --apply >/dev/null
python3 - "$state/payload.json" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["required_status_checks"] == {
    "strict": True,
    "checks": [{"context": "validate", "app_id": 15368}],
}
assert payload["enforce_admins"] is True
assert payload["required_pull_request_reviews"]["required_approving_review_count"] == 0
assert payload["required_pull_request_reviews"]["dismiss_stale_reviews"] is True
assert payload["allow_force_pushes"] is False
assert payload["allow_deletions"] is False
assert payload["required_conversation_resolution"] is True
PY
[[ "$(grep -c -- '--method PUT' "$state/calls.log")" -eq 1 ]]

state="$(new_state existing)"
run_script "$state" protected-good --apply >/dev/null
[[ "$(grep -c -- '--method PUT' "$state/calls.log" || true)" -eq 0 ]]

state="$(new_state incomplete)"
if run_script "$state" protected-incomplete --apply >/dev/null 2>&1; then
  echo "expected incomplete existing protection to fail closed" >&2
  exit 1
fi
[[ "$(grep -c -- '--method PUT' "$state/calls.log" || true)" -eq 0 ]]

state="$(new_state missing-check)"
if run_script "$state" missing-check --apply >/dev/null 2>&1; then
  echo "expected missing main CI check to prevent protection mutation" >&2
  exit 1
fi
[[ "$(grep -c -- '--method PUT' "$state/calls.log" || true)" -eq 0 ]]

state="$(new_state verify-only)"
if run_script "$state" unprotected --verify-only >/dev/null 2>&1; then
  echo "expected verify-only mode to report an unprotected main branch" >&2
  exit 1
fi
[[ "$(grep -c -- '--method PUT' "$state/calls.log" || true)" -eq 0 ]]

state="$(new_state invalid-repo)"
if PATH="$TMP/bin:$PATH" FAKE_GH_STATE_DIR="$state" FAKE_GH_MODE=unprotected \
  bash "$SCRIPT" --repository 'bad/repo/name' --apply >/dev/null 2>&1; then
  echo "expected malformed repository identity to fail" >&2
  exit 1
fi
[[ ! -s "$state/calls.log" ]]

echo "main protection setup contract passed"
