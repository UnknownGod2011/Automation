# AWS Vertical Demo Runbook

Use a permitted test site/account. CAPTCHA, MFA, security challenges, and anti-bot controls remain human-operated and must never be bypassed. Configure a verified SES sender when testing email and add OpenAI BYOK only through the product UI.

## Deploy

Deploy a green exact-head release through `.github/workflows/deploy-aws.yml` or the immutable release/deploy scripts. The environment must provide deployment-owned VPC subnet/security-group IDs plus a stable custom Browser name; the deployment itself provisions `AWS::BedrockAgentCore::BrowserCustom`, verifies its live VPC state, and derives the resulting Browser ID/ARN into Runtime and control-plane stacks.

The deployment result includes `outputs.webOrigin`; the Next.js control plane is provisioned automatically as a bounded public Lambda Function URL and finalized with the exact Cognito/control-plane coordinates. No separate web host or manually pre-created AgentCore Browser is required for the first AWS demo.

Before using arbitrary target hosts, validate the deployed Browser VPC's route tables, DNS behavior, security groups, network ACLs, and firewall/proxy policy against private/link-local/control-plane destinations after DNS resolution and redirects. VPC mode is a required boundary, not proof that the boundary is correctly configured.

For local debugging only, `scripts/prepare-web-demo-env.sh` may still generate a non-secret `.env.local` from deployment outputs and a chosen Cognito-compatible origin.

## Built-in controlled target (recommended for the first vertical)

The deployed Next.js app contains an intentionally harmless demo target at `${webOrigin}/demo-target`, but it is **disabled by default**. Enable it only in a staging/demo environment by setting these non-secret web stack parameters:

```json
{
  "parameters": {
    "web": {
      "DemoTargetEnabled": "true",
      "DemoTargetSessionTtlSeconds": 900
    }
  }
}
```

The target has no AWS data-plane permissions or durable server-side state. Its sign-in button sets only a short-lived, scoped `HttpOnly; Secure; SameSite=Lax` demo cookie. The workflow form contains one ordinary single-select priority, one non-secret note, one required harmless confirmation checkbox, and one native submit action. The target accepts only `low`, `normal`, or `high` as the posted priority value, accepts the fixed checkbox confirmation only when checked, and never reflects submitted workflow inputs into the response. A fresh navigation always begins from the same form, so captured structural effect verification remains meaningful on every Fresh Test and scheduled run.

The priority dropdown exercises the explicit provider-neutral `SELECT` node end to end. During capture, change **Normal priority** to **High priority** so the browser emits a real select-change event. The selected label is not stored in the capture trace; the compiled workflow exposes the resulting `capture_input_N` requirement through the sanitized workflow-inspection/runtime-input UX. For Fresh Test and publish-time non-secret scheduled inputs, set that generated input to `High priority`.

The confirmation checkbox exercises the explicit deterministic `CHECK` node end to end. During capture, check **Confirm this harmless demo action** once. Capture stores only the demonstrated boolean state, never the HTML checkbox value. The compiled CHECK intent is immutable and requires independent selected-state verification; it is not another runtime input and is not sent to semantic/model recovery.

The cookie expiry is intentional. Once the browser no longer sends it, `GET /demo-target` returns HTTP 401. The existing Playwright runtime classifies that navigation as `TARGET_AUTH_REQUIRED`, so waiting for the configured TTL provides a controlled way to exercise the real secure takeover/profile-save/resume path without depending on a third-party site's authentication behavior. This is simulated target authentication only; it protects no user data and must not be presented as a real authentication system.

Recommended objective: `Choose the provided priority, enter the provided non-secret demo note, confirm the harmless demo action, and complete the demo task.` During Live View, click **Sign in to demo target** before pressing **Start recording workflow**, then change priority to **High priority**, type a non-secret note, check the confirmation checkbox, and submit **Complete demo task**.

## Controlled success path

1. Open `outputs.webOrigin` and sign in through Cognito.
2. If using Google sign-in, after the first successful federation run `scripts/verify-google-demo-user.sh --deployment <deployment-result.json> --email <signed-in-email>`. Continue with SES notification evidence only if it confirms one Google-linked Cognito user with `email_verified=true`.
3. Add one OpenAI BYOK credential; confirm only masked metadata returns.
4. Create an authorized automation with HTTPS site URL, objective, consent, and notification preference. For the first controlled run, use `${webOrigin}/demo-target` with the built-in target enabled.
5. Start cloud capture; sign in to the target site yourself in Live View.
6. Start workflow recording only after collector readiness, change **Priority** to **High priority**, type a reusable non-secret note, check **Confirm this harmless demo action**, submit the form, and finish capture.
7. Confirm capture becomes Compile-ready without copying internal identifiers and review retained capture screenshots.
8. Compile and inspect the semantic plan. Confirm it contains one explicit SELECT step, one TYPE step, one CHECK step, and one verified SUBMIT step. Confirm a checkbox/select click-change pair did not create a duplicate generic CLICK.
9. Run a fresh AgentCore test using only the exact displayed runtime-input requirements. Supply `High priority` for the select requirement and a non-secret note for the text requirement; CHECK needs no runtime value. Approve only after verification succeeds. Include one test that lasts longer than 30 seconds and confirm the web request returns promptly while the page follows the durable result.
10. Publish with a near-future recurrence/timezone and configure the same reusable non-secret SELECT/TEXT values through the guided scheduled-input boundary, then close the user browser/device.
11. Confirm Scheduler -> SQS -> Step Functions -> AgentCore Runtime reaches a verified terminal run with the device offline.
12. Confirm sanitized run history/timeline/reasoning/evidence, optional SES success email, and low-cardinality CloudWatch/EMF telemetry.

## Controlled human-recovery path

Allow the built-in target's short-lived demo auth cookie to expire. Let the next run reach `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, open the secure repair Live View, complete the demo login manually, save the repaired session, and resume. Confirm Browser Profile persistence precedes resume and the post-resume terminal email/metric appears once.

## Stop conditions and evidence

Stop and treat the result as a product defect if tenant/user/profile/credential scope can be chosen by a request, a consequential action advances without verification, duplicate delivery repeats an external effect, SELECT/CHECK are replayed as generic typing/clicking instead of their explicit primitives, a target security challenge is bypassed, secrets appear in UI/email/logs, retry does not terminate in a bounded state, a Google-federated Cognito user intended for notification evidence is not both Google-linked and email-verified, or Browser networking permits access to infrastructure-local/private control-plane destinations that the deployment intends to block.

Retain only deployment outputs, sanitized run IDs/statuses, selected secret-free logs, and demo screenshots/video. Never retain cookies, OAuth tokens, BYOK keys, workload tokens, Browser Profile contents, Live View credentials, secret-bearing DOM/input values, or hidden model reasoning.
