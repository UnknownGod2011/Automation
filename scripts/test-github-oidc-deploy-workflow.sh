#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_WORKFLOW="$ROOT_DIR/.github/workflows/deploy-aws.yml"
CI_WORKFLOW="$ROOT_DIR/.github/workflows/ci.yml"

[[ -f "$DEPLOY_WORKFLOW" ]] || { echo "missing AWS deployment workflow" >&2; exit 1; }
[[ -f "$CI_WORKFLOW" ]] || { echo "missing CI workflow" >&2; exit 1; }

python3 - "$DEPLOY_WORKFLOW" "$CI_WORKFLOW" <<'PY'
from pathlib import Path
import re
import sys

deploy = Path(sys.argv[1]).read_text()
ci = Path(sys.argv[2]).read_text()

checkout = "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5"
pnpm_setup = "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1"
setup_node = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"
aws_credentials = "aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c"
protection_gate = "Verify protected main promotion boundary"

required = [
    "workflow_dispatch:",
    "type: environment",
    "contents: read",
    "id-token: write",
    "if: github.ref == 'refs/heads/main'",
    "environment: ${{ inputs.target_environment }}",
    "cancel-in-progress: false",
    checkout,
    pnpm_setup,
    setup_node,
    "bash scripts/materialize-pnpm-lock.sh",
    "pnpm install --frozen-lockfile",
    "pnpm check",
    "pnpm test",
    protection_gate,
    'f"{api_url}/repos/{repository}/branches/main"',
    'branch.get("protected") is not True',
    'branch_head != source_sha',
    "GITHUB_TOKEN: ${{ github.token }}",
    aws_credentials,
    "role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}",
    "allowed-account-ids: ${{ vars.AWS_ACCOUNT_ID }}",
    "aws sts get-caller-identity",
    "scripts/release-aws-artifacts.sh",
    "scripts/deploy-aws-release.sh",
    "scripts/smoke-aws-deployment.sh",
    '--environment "$RUNNER_TEMP/automation-environment.json"',
    "$RUNNER_TEMP/aws-release.json",
    "$RUNNER_TEMP/aws-deployment.json",
    "demo-target exposure matches environment configuration",
    "no Actions artifacts retained",
]
for needle in required:
    if needle not in deploy:
        raise SystemExit(f"deployment workflow is missing required invariant: {needle}")

for needle in (checkout, pnpm_setup, setup_node):
    if needle not in ci:
        raise SystemExit(f"CI workflow is missing immutable action pin: {needle}")

for path, text in (("deploy", deploy), ("ci", ci)):
    for match in re.finditer(r"uses:\s+([^\s#]+)", text):
        ref = match.group(1)
        if ref.startswith("./") or ref.startswith("docker://"):
            continue
        if not re.fullmatch(r"[^@\s]+@[0-9a-f]{40}", ref):
            raise SystemExit(f"{path} workflow contains a mutable GitHub Action reference: {ref}")

for forbidden in (
    "actions/upload-artifact",
    "aws-access-key-id:",
    "aws-secret-access-key:",
    "aws-session-token:",
    "secrets.AWS_ACCESS_KEY_ID",
    "secrets.AWS_SECRET_ACCESS_KEY",
):
    if forbidden in deploy:
        raise SystemExit(f"deployment workflow contains forbidden credential/artifact pattern: {forbidden}")

configure_position = deploy.index(aws_credentials)
check_position = deploy.index("pnpm check")
test_position = deploy.index("pnpm test")
protection_position = deploy.index(protection_gate)
if configure_position < check_position or configure_position < test_position:
    raise SystemExit("AWS credentials must be assumed only after source validation succeeds")
if configure_position < protection_position:
    raise SystemExit("AWS credentials must be assumed only after protected-main verification succeeds")

if "${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" not in deploy:
    raise SystemExit("release identity must bind source SHA and workflow attempt")
PY

printf 'GitHub OIDC deployment workflow contract verified.\n'