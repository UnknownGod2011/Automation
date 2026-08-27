#!/usr/bin/env bash
set -euo pipefail

REQUIRED_CHECK_CONTEXT="validate"
GITHUB_ACTIONS_APP_ID="15368"
API_VERSION="2022-11-28"
repository=""
mode="verify"

usage() {
  cat <<'USAGE'
Usage: configure-main-protection.sh --repository OWNER/REPO [--apply|--verify-only]

Verifies the production main-branch protection baseline. --apply creates the
baseline only when main is currently unprotected. Existing protection is never
overwritten or relaxed by this command.

Authentication is inherited from the GitHub CLI. The authenticated principal
must have repository Administration: write permission to use --apply.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --repository)
      [[ $# -ge 2 ]] || { echo "--repository requires OWNER/REPO" >&2; exit 2; }
      repository="$2"
      shift 2
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --verify-only)
      mode="verify"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "--repository must be a GitHub OWNER/REPO identifier" >&2
  exit 2
}
command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required" >&2
  exit 2
}

api() {
  gh api \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: ${API_VERSION}" \
    "$@"
}

verify_protection() {
  local protection_json="$1"
  python3 -c '
import json, sys
context = sys.argv[1]
app_id = int(sys.argv[2])
document = json.load(sys.stdin)
status = document.get("required_status_checks") or {}
if status.get("strict") is not True:
    raise SystemExit("main protection must require strict/up-to-date status checks")
checks = status.get("checks") or []
if not any(isinstance(item, dict) and item.get("context") == context and item.get("app_id") == app_id for item in checks):
    raise SystemExit(f"main protection must require GitHub Actions check {context!r}")
reviews = document.get("required_pull_request_reviews")
if not isinstance(reviews, dict):
    raise SystemExit("main protection must require pull requests")
if reviews.get("required_approving_review_count") != 0:
    raise SystemExit("main baseline expects PRs without a mandatory external reviewer")
for field, message in (("enforce_admins", "main protection must apply to administrators"), ("required_conversation_resolution", "main protection must require resolved conversations")):
    value = document.get(field)
    if not isinstance(value, dict) or value.get("enabled") is not True:
        raise SystemExit(message)
for field, message in (("allow_force_pushes", "main protection must block force pushes"), ("allow_deletions", "main protection must block branch deletion")):
    value = document.get(field)
    if not isinstance(value, dict) or value.get("enabled") is not False:
        raise SystemExit(message)
' "$REQUIRED_CHECK_CONTEXT" "$GITHUB_ACTIONS_APP_ID" <<<"$protection_json"
}

branch_endpoint="repos/${repository}/branches/main"
protection_endpoint="${branch_endpoint}/protection"
branch_json="$(api "$branch_endpoint")"
protected="$(printf '%s' "$branch_json" | python3 -c 'import json,sys; print("true" if json.load(sys.stdin).get("protected") is True else "false")')"
head_sha="$(printf '%s' "$branch_json" | python3 -c 'import json,sys; print(((json.load(sys.stdin).get("commit") or {}).get("sha") or ""))')"
[[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "could not resolve the current main head" >&2
  exit 3
}

if [[ "$protected" == "true" ]]; then
  protection_json="$(api "$protection_endpoint")"
  verify_protection "$protection_json"
  echo "main already satisfies the Automation production protection baseline"
  exit 0
fi

if [[ "$mode" != "apply" ]]; then
  echo "main is not protected; rerun with --apply using an admin-authorized GitHub CLI session" >&2
  exit 4
fi

check_runs="$(api "repos/${repository}/commits/${head_sha}/check-runs?per_page=100")"
python3 -c '
import json, sys
context = sys.argv[1]
app_id = int(sys.argv[2])
head_sha = sys.argv[3]
document = json.load(sys.stdin)
for check in document.get("check_runs") or []:
    app = check.get("app") or {}
    if check.get("name") == context and check.get("head_sha") == head_sha and check.get("status") == "completed" and check.get("conclusion") == "success" and app.get("id") == app_id:
        break
else:
    raise SystemExit(f"current main head must have successful GitHub Actions check {context!r} before protection is applied")
' "$REQUIRED_CHECK_CONTEXT" "$GITHUB_ACTIONS_APP_ID" "$head_sha" <<<"$check_runs"

payload="$(python3 - "$REQUIRED_CHECK_CONTEXT" "$GITHUB_ACTIONS_APP_ID" <<'PY'
import json
import sys

context = sys.argv[1]
app_id = int(sys.argv[2])
print(json.dumps({
    "required_status_checks": {
        "strict": True,
        "checks": [{"context": context, "app_id": app_id}],
    },
    "enforce_admins": True,
    "required_pull_request_reviews": {
        "dismiss_stale_reviews": True,
        "require_code_owner_reviews": False,
        "required_approving_review_count": 0,
        "require_last_push_approval": False,
    },
    "restrictions": None,
    "required_linear_history": False,
    "allow_force_pushes": False,
    "allow_deletions": False,
    "block_creations": False,
    "required_conversation_resolution": True,
    "lock_branch": False,
    "allow_fork_syncing": False,
}, separators=(",", ":")))
PY
)"

printf '%s' "$payload" | api --method PUT --input - "$protection_endpoint" >/dev/null

updated_branch="$(api "$branch_endpoint")"
python3 -c '
import json, sys
expected_head = sys.argv[1]
branch = json.load(sys.stdin)
if branch.get("protected") is not True:
    raise SystemExit("GitHub did not report main as protected after applying the baseline")
if ((branch.get("commit") or {}).get("sha")) != expected_head:
    raise SystemExit("main moved while branch protection was being applied; verify the repository before deployment")
' "$head_sha" <<<"$updated_branch"

verify_protection "$(api "$protection_endpoint")"
echo "main now satisfies the Automation production protection baseline"
