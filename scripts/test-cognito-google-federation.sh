#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT_DIR/infra/aws/control-plane-auth.yaml"

python3 - "$TEMPLATE" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
required = [
    "GoogleClientId:",
    "GoogleClientSecretArn:",
    "GoogleFederationParameters:",
    "HasGoogleFederation:",
    "Type: AWS::Cognito::UserPoolIdentityProvider",
    "ProviderName: Google",
    "ProviderType: Google",
    "authorize_scopes: 'email profile openid'",
    "client_id: !Ref GoogleClientId",
    "client_secret: !Sub '{{resolve:secretsmanager:${GoogleClientSecretArn}:SecretString}}'",
    "- !If [HasGoogleFederation, !Ref AutomationGoogleIdentityProvider, !Ref 'AWS::NoValue']",
    "GoogleFederationEnabled:",
]
missing = [item for item in required if item not in template]
if missing:
    raise SystemExit("missing Google federation contract: " + ", ".join(missing))

if "GoogleClientSecret:" in template:
    raise SystemExit("raw Google OAuth client secret must never be a CloudFormation parameter")
if "client_secret: !Ref" in template:
    raise SystemExit("Google OAuth client secret must be resolved from Secrets Manager, not a plaintext parameter")
if template.count("SupportedIdentityProviders:") != 1 or template.count("- COGNITO") != 1:
    raise SystemExit("native Cognito email sign-in must remain enabled exactly once")
PY
