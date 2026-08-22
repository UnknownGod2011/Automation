# AWS Vertical Demo Runbook

Use a permitted test site/account. CAPTCHA, MFA, security challenges, and anti-bot controls remain human-operated and must never be bypassed. Configure a verified SES sender when testing email and add OpenAI BYOK only through the product UI.

## Deploy

Deploy a green exact-head release through `.github/workflows/deploy-aws.yml` or the immutable release/deploy scripts. The deployment result includes `outputs.webOrigin`; the Next.js control plane is provisioned automatically as a bounded public Lambda Function URL and finalized with the exact Cognito/control-plane coordinates. No separate web host is required for the first AWS demo.

For local debugging only, `scripts/prepare-web-demo-env.sh` may still generate a non-secret `.env.local` from deployment outputs and a chosen Cognito-compatible origin.

## Controlled success path

1. Open `outputs.webOrigin` and sign in through Cognito.
2. If using Google sign-in, after the first successful federation run `scripts/verify-google-demo-user.sh --deployment <deployment-result.json> --email <signed-in-email>`. Continue with SES notification evidence only if it confirms one Google-linked Cognito user with `email_verified=true`.
3. Add one OpenAI BYOK credential; confirm only masked metadata returns.
4. Create an authorized automation with HTTPS site URL, objective, consent, and notification preference.
5. Start cloud capture; sign in to the target site yourself in Live View.
6. Start workflow recording, demonstrate the reusable flow, and finish capture.
7. Confirm capture becomes Compile-ready without copying internal identifiers.
8. Compile and inspect the semantic plan, then run a fresh AgentCore test; approve only after verification succeeds.
9. Publish with a near-future recurrence/timezone and any explicitly non-secret recurring inputs, then close the user browser/device.
10. Confirm Scheduler -> SQS -> Step Functions -> AgentCore Runtime reaches a verified terminal run.
11. Confirm sanitized run history, optional SES success email, and low-cardinality CloudWatch/EMF telemetry.

## Controlled human-recovery path

Deliberately invalidate only target-site authentication, allow the next run to reach `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, open the secure repair Live View, complete login/MFA manually, save the repaired session, and resume. Confirm Browser Profile persistence precedes resume and the post-resume terminal email/metric appears once.

## Stop conditions and evidence

Stop and treat the result as a product defect if tenant/user/profile/credential scope can be chosen by a request, a consequential action advances without verification, duplicate delivery repeats an external effect, a target security challenge is bypassed, secrets appear in UI/email/logs, retry does not terminate in a bounded state, or a Google-federated Cognito user intended for notification evidence is not both Google-linked and email-verified.

Retain only deployment outputs, sanitized run IDs/statuses, selected secret-free logs, and demo screenshots/video. Never retain cookies, OAuth tokens, BYOK keys, workload tokens, Browser Profile contents, Live View credentials, secret-bearing DOM/input values, or hidden model reasoning.
