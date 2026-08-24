#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat >"$tmp/deployment.json" <<'JSON'
{
  "schemaVersion": 1,
  "region": "us-east-1",
  "stacks": {"auth": "automation-demo-auth"},
  "outputs": {}
}
JSON

cat >"$tmp/bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${FAKE_AWS_CALLS:?}"
if [[ "$*" == *"cloudformation describe-stacks"* ]]; then
  printf '%s\n' 'us-east-1_demoPool'
  exit 0
fi
if [[ "$*" != *"cognito-idp list-users"* ]]; then
  echo "unexpected fake aws call: $*" >&2
  exit 99
fi
case "${FAKE_SCENARIO:-success}" in
  success)
    cat <<'JSON'
{"Users":[{"Username":"Google_redacted","Enabled":true,"Attributes":[{"Name":"sub","Value":"00000000-0000-0000-0000-000000000000"},{"Name":"email","Value":"demo@example.com"},{"Name":"email_verified","Value":"true"},{"Name":"identities","Value":"[{\"providerName\":\"Google\",\"providerType\":\"Google\"}]"}]}]}
JSON
    ;;
  unverified)
    cat <<'JSON'
{"Users":[{"Username":"Google_redacted","Enabled":true,"Attributes":[{"Name":"email","Value":"demo@example.com"},{"Name":"email_verified","Value":"false"},{"Name":"identities","Value":"[{\"providerName\":\"Google\"}]"}]}]}
JSON
    ;;
  native)
    cat <<'JSON'
{"Users":[{"Username":"native-user","Enabled":true,"Attributes":[{"Name":"email","Value":"demo@example.com"},{"Name":"email_verified","Value":"true"}]}]}
JSON
    ;;
  ambiguous)
    cat <<'JSON'
{"Users":[{"Username":"Google_one","Enabled":true,"Attributes":[{"Name":"email","Value":"demo@example.com"},{"Name":"email_verified","Value":"true"},{"Name":"identities","Value":"[{\"providerName\":\"Google\"}]"}]},{"Username":"Google_two","Enabled":true,"Attributes":[{"Name":"email","Value":"demo@example.com"},{"Name":"email_verified","Value":"true"},{"Name":"identities","Value":"[{\"providerName\":\"Google\"}]"}]}]}
JSON
    ;;
  *) echo "unknown FAKE_SCENARIO" >&2; exit 98 ;;
esac
EOF
chmod +x "$tmp/bin/aws"

run_verify() {
  FAKE_AWS_CALLS="$tmp/aws.calls" FAKE_SCENARIO="$1" PATH="$tmp/bin:$PATH" \
    bash "$repo_root/scripts/verify-google-demo-user.sh" \
      --deployment "$tmp/deployment.json" \
      --email demo@example.com
}

: >"$tmp/aws.calls"
output="$(run_verify success)"
[[ "$output" == 'Verified Google-federated Cognito user for trusted notification evidence.' ]] || {
  echo "unexpected success output: $output" >&2
  exit 1
}
grep -q 'CognitoUserPoolId' "$tmp/aws.calls"
grep -q 'cognito-idp list-users' "$tmp/aws.calls"
grep -q 'email = "demo@example.com"' "$tmp/aws.calls"

for scenario in unverified native ambiguous; do
  if run_verify "$scenario" >/dev/null 2>&1; then
    echo "verification unexpectedly succeeded for $scenario" >&2
    exit 1
  fi
done

: >"$tmp/aws.calls"
if FAKE_AWS_CALLS="$tmp/aws.calls" PATH="$tmp/bin:$PATH" \
  bash "$repo_root/scripts/verify-google-demo-user.sh" \
    --deployment "$tmp/deployment.json" \
    --email 'bad"@example.com' >/dev/null 2>&1; then
  echo "invalid email unexpectedly passed validation" >&2
  exit 1
fi
[[ ! -s "$tmp/aws.calls" ]] || {
  echo "invalid email should fail before any AWS call" >&2
  exit 1
}

printf '%s\n' 'Google demo user verification contract passed.'
