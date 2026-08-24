#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/deploy-aws.yml"

[[ -f "$WORKFLOW" ]] || { echo "missing AWS deployment workflow" >&2; exit 1; }

python3 - "$WORKFLOW" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()
required = [
    "workflow_dispatch:",
    "type: environment",
    "contents: read",
    "id-token: write",
    "if: github.ref == 'refs/heads/main'",
    "environment: ${{ inputs.target_environment }}",
    "cancel-in-progress: false",
    "bash scripts/materialize-pnpm-lock.sh",
    "pnpm install --frozen-lockfile",
    "pnpm check",
    "pnpm test",
    "aws-actions/configure-aws-credentials@v6.2.3",
    "role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}",
    "allowed-account-ids: ${{ vars.AWS_ACCOUNT_ID }}",
    "aws sts get-caller-identity",
    "scripts/release-aws-artifacts.sh",
    "scripts/deploy-aws-release.sh",
    "$RUNNER_TEMP/aws-release.json",
    "$RUNNER_TEMP/aws-deployment.json",
    "no Actions artifacts retained",
]
for needle in required:
    if needle not in text:
        raise SystemExit(f"deployment workflow is missing required invariant: {needle}")

for forbidden in (
    "actions/upload-artifact",
    "aws-access-key-id:",
    "aws-secret-access-key:",
    "aws-session-token:",
    "secrets.AWS_ACCESS_KEY_ID",
    "secrets.AWS_SECRET_ACCESS_KEY",
):
    if forbidden in text:
        raise SystemExit(f"deployment workflow contains forbidden credential/artifact pattern: {forbidden}")

configure_position = text.index("aws-actions/configure-aws-credentials@v6.2.3")
check_position = text.index("pnpm check")
test_position = text.index("pnpm test")
if configure_position < check_position or configure_position < test_position:
    raise SystemExit("AWS credentials must be assumed only after source validation succeeds")

if "${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" not in text:
    raise SystemExit("release identity must bind source SHA and workflow attempt")
PY

printf 'GitHub OIDC deployment workflow contract verified.\n'
