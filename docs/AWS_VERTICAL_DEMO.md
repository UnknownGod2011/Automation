# AWS Vertical Demo Runbook

This runbook is for the first controlled production-like AWS demonstration. It does not replace CI: GitHub Actions validates source/build contracts; this runbook validates the deployed cloud boundary with real Cognito, AgentCore, OpenAI BYOK, Scheduler, SES, and Browser resources.

## Preconditions

- Deploy a green exact-head release with `.github/workflows/deploy-aws.yml` or the immutable release/deploy scripts.
- Use short-lived AWS credentials or GitHub OIDC. Do not place AWS access keys in repo files, shell history, or web environment files.
- Use a permitted test website/account where automation is authorized. CAPTCHA, MFA, security challenges, and anti-bot controls remain human-operated and must never be bypassed.
- Configure a verified SES sender if email validation is part of the demo.
- Configure one OpenAI BYOK credential through the product UI; do not inject it into deployment environment JSON.

## Configure the Next.js web app from deployed outputs

The deployment command emits `dist/aws-deployment-<releaseId>.json`. Generate the non-secret server environment and verify the deployed Cognito app client matches the exact web origin:

```bash
bash scripts/prepare-web-demo-env.sh \
  --deployment dist/aws-deployment-<releaseId>.json \
  --origin https://your-web-origin.example \
  --output apps/web/.env.local
```

The generated file contains only:

- `AUTOMATION_CONTROL_PLANE_URL`
- `AUTOMATION_COGNITO_DOMAIN`
- `AWS_COGNITO_APP_CLIENT_ID`
- `AUTOMATION_WEB_ORIGIN`

The script queries the deployed Cognito app client and fails before writing the file unless authorization-code flow is enabled, `openid email profile` scopes are present, and the exact callback/logout URLs match the requested origin. It never writes AWS credentials, Cognito tokens, provider keys, workload tokens, browser sessions, or Browser Profile references.

## Controlled success path

1. Open the deployed web origin and sign in through Cognito.
2. Open **Credentials** and add one OpenAI BYOK key. Confirm the UI returns only masked/sanitized metadata.
3. Create an automation with a permitted HTTPS website URL, a narrow objective, consent acknowledgement, and notification preferences.
4. Start **Cloud capture**. In Live View, sign in to the target site yourself.
5. Select **Start recording workflow**, demonstrate the reusable workflow, then **Finish capture**.
6. Confirm capture automatically reaches Compile-ready state; no trace/session/profile identifier should need manual copying.
7. Compile the latest capture and run a fresh cloud test. Confirm the fresh test executes through AgentCore Runtime and the Browser Profile is reused.
8. Inspect the run result and only then approve/publish with a near-future recurrence and the intended IANA timezone.
9. Close the user browser/device before the scheduled occurrence.
10. Confirm the scheduled occurrence traverses Scheduler -> SQS -> Step Functions -> AgentCore Runtime and reaches a terminal verified run state.
11. Confirm run history is visible and sanitized. If success notifications are enabled and SES is configured, confirm receipt of one success email.
12. Confirm CloudWatch/EMF correlation uses stable run identifiers without raw browser/provider errors or secrets.

## Controlled human-recovery path

1. Deliberately invalidate only the target-site authentication for the same permitted test account (for example, sign out of that target account). Do not trigger or bypass a security control.
2. Run or wait for the next occurrence and confirm it reaches `WAITING_FOR_HUMAN` with `TARGET_AUTH_REQUIRED` rather than looping.
3. Open the run diagnostics and choose **Open secure repair browser**.
4. Complete target login/MFA manually in Live View.
5. Choose **Save repaired session & resume**.
6. Confirm the repaired Browser Profile is persisted before resume, the run resumes through the existing idempotent human-resolution boundary, and the workflow reaches a verified terminal state.
7. Confirm the post-resume SES/CloudWatch outcome is emitted once; duplicate clicks/delivery must not intentionally create another website action or completion email.

## Evidence to retain

Retain the deployment result JSON, CloudFormation stack events/outputs, selected CloudWatch log excerpts, sanitized run IDs/statuses, and screenshots/video needed for the demo narrative. Do not retain or publish cookies, access/refresh tokens, BYOK keys, workload tokens, Browser Profile contents, Live View credentials, raw secret-bearing DOM/input values, or hidden model reasoning.

## Stop conditions

Stop the demo and treat it as a product defect if any of the following occurs:

- OAuth callback/logout configuration does not match the deployed web origin.
- A request can choose another tenant/user, Browser Profile, credential reference, or notification recipient.
- A consequential browser action advances without its declared verification succeeding.
- Duplicate schedule/resume delivery causes a second external action.
- A target security challenge is bypassed instead of surfaced to the user.
- Provider/browser errors expose secrets in UI, email, telemetry, or logs.
- A run continues indefinitely instead of exhausting bounded retry/human-attention policy.

Fix defects exposed by this controlled deployment before adding narrower recovery machinery.
