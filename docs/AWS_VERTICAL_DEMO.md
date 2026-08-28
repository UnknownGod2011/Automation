# AWS Vertical Demo Runbook

Use a permitted test site/account. CAPTCHA, MFA, security challenges, and anti-bot controls remain human-operated and must never be bypassed. Configure a verified SES sender when testing email and add OpenAI BYOK only through the product UI.

## Deploy

Deploy a green exact-head release through `.github/workflows/deploy-aws.yml` or the immutable release/deploy scripts. The environment must provide deployment-owned VPC subnet/security-group IDs plus a stable custom Browser name; the deployment itself provisions `AWS::BedrockAgentCore::BrowserCustom`, verifies its live VPC state, and derives the resulting Browser ID/ARN into Runtime and control-plane stacks.

The deployment result includes `outputs.webOrigin`; the Next.js control plane is provisioned automatically as a bounded public Lambda Function URL and finalized with the exact Cognito/control-plane coordinates. No separate web host or manually pre-created AgentCore Browser is required for the first AWS demo.

Before using arbitrary target hosts, validate the deployed Browser VPC's route tables, DNS behavior, security groups, network ACLs, and firewall/proxy policy against private/link-local/control-plane destinations after DNS resolution and redirects. VPC mode is a required boundary, not proof that the boundary is correctly configured.

For local debugging only, `scripts/prepare-web-demo-env.sh` may still generate a non-secret `.env.local` from deployment outputs and a chosen Cognito-compatible origin.

## Built-in controlled target (recommended for the first vertical)

The deployed Next.js app contains an intentionally harmless demo target at `${webOrigin}/demo-target`, but it is **disabled by default**. Enable it only in a staging/demo environment. Keep semantic drift disabled while teaching the workflow:

```json
{
  "parameters": {
    "web": {
      "DemoTargetEnabled": "true",
      "DemoTargetSessionTtlSeconds": 900,
      "DemoTargetSemanticDriftEnabled": "false"
    }
  }
}
```

The target has no AWS data-plane permissions or durable server-side state. Its sign-in button sets only a short-lived, scoped `HttpOnly; Secure; SameSite=Lax` demo cookie. The workflow form contains one ordinary single-select priority, one native two-option handling-mode radio group, one non-secret note, one required harmless confirmation checkbox, and one native submit action. The target accepts only `low`, `normal`, or `high` as the posted priority value, requires **Focused handling** as the selected radio option, accepts the fixed checkbox confirmation only when checked, and never reflects submitted workflow inputs into the response. A fresh navigation always begins from the same form with **Standard handling** selected, so the radio step has to execute for a successful run and captured structural effect verification remains meaningful on every Fresh Test and scheduled run.

The priority dropdown exercises the explicit provider-neutral `SELECT` node end to end. During capture, change **Normal priority** to **High priority**. For Fresh Test and publish-time non-secret scheduled inputs, supply the displayed select requirement with `High priority`.

The handling-mode radio group exercises deterministic captured radio support end to end. During capture, change **Standard handling** to **Focused handling**. Capture discards the radio's HTML value and compiles the demonstrated semantic target into immutable checked-state intent.

The confirmation checkbox exercises the explicit deterministic `CHECK` node end to end. During capture, check **Confirm this harmless demo action** once. Capture stores only the demonstrated boolean state, never the HTML checkbox value.

The cookie expiry is intentional. Once the browser no longer sends it, `GET /demo-target` returns HTTP 401. The existing Playwright runtime classifies that navigation as `TARGET_AUTH_REQUIRED`, so waiting for the configured TTL provides a controlled way to exercise the real secure takeover/profile-save/resume path without depending on a third-party site's authentication behavior.

Recommended objective: `Choose the provided priority, select Focused handling, enter the provided non-secret demo note, confirm the harmless demo action, and complete the demo task.` During Live View, click **Sign in to demo target** before pressing **Start recording workflow**, then change priority to **High priority**, change handling mode to **Focused handling**, type a non-secret note, check the confirmation checkbox, and submit **Complete demo task**.

## Controlled semantic-recovery drift

After capture is finished and the semantic plan has been reviewed, opt into the first-party drift fixture by changing only the non-secret web parameter `DemoTargetSemanticDriftEnabled` to `true` and redeploying the **same immutable release manifest**. Re-run `scripts/smoke-aws-deployment.sh --deployment ... --environment ...`; the smoke gate now checks that the configured drift fixture is actually live.

The baseline capture uses an in-form `<button data-testid="demo-submit">Complete demo task</button>`. Drift mode removes that captured submit element and exposes a semantically equivalent `<input type="submit">` outside the form, associated through `form="demo-form"`, with a different test-id and accessible name (`demo-semantic-submit`, `Finish controlled demo after selector drift`). The POST destination, accepted fields, response, and verification effect are unchanged. This intentionally changes target identity, name, element type, and DOM placement without creating a second business side effect.

During Fresh Test, confirm the deterministic SUBMIT target fails and the run enters semantic recovery. The bounded browser observation should expose the replacement as an untrusted `button` observation with its new name/test-id. Confirm the reasoning timeline shows only `SUBMIT` authority, one recovered submit activation, and successful existing post-effect verification. If the run completes without recording semantic recovery, treat the drift fixture as insufficient and stop rather than claiming the OpenAI fallback was demonstrated.

Never enable this fixture on arbitrary third-party sites. It exists only to prove the platform's constrained recovery behavior against the built-in harmless target.

## Controlled success path

1. Open `outputs.webOrigin` and sign in through Cognito.
2. If using Google sign-in, after the first successful federation run `scripts/verify-google-demo-user.sh --deployment <deployment-result.json> --email <signed-in-email>`. Continue with SES notification evidence only if it confirms one Google-linked Cognito user with `email_verified=true`.
3. Add one OpenAI BYOK credential; confirm only masked metadata returns.
4. Create an authorized automation with HTTPS site URL, objective, consent, and notification preference. For the first controlled run, use `${webOrigin}/demo-target` with the built-in target enabled and semantic drift disabled.
5. Start cloud capture; sign in to the target site yourself in Live View.
6. Start workflow recording only after collector readiness, change **Priority** to **High priority**, change **Handling mode** to **Focused handling**, type a reusable non-secret note, check **Confirm this harmless demo action**, submit the form, and finish capture.
7. Confirm capture becomes Compile-ready without copying internal identifiers and review retained capture evidence.
8. Compile and inspect the semantic plan. Confirm it contains one SELECT step, one TYPE step, two semantic checked-state steps (radio + checkbox), and one verified SUBMIT step. Confirm radio/checkbox/select click-change pairs did not create duplicate generic CLICK actions.
9. Enable `DemoTargetSemanticDriftEnabled=true` on the same immutable release and require the strengthened live smoke to pass.
10. Run a fresh AgentCore test using only the displayed runtime-input requirements. Supply `High priority` for the select requirement and a non-secret note for the text requirement. Confirm the SUBMIT step reaches semantic recovery through bounded live observations, performs exactly one constrained recovered action, and still requires the captured completion effect. Include one test that lasts longer than 30 seconds and confirm the web request returns promptly while the page follows the durable result.
11. Publish with a near-future recurrence/timezone and configure the same reusable non-secret SELECT/TEXT values through the guided scheduled-input boundary, then close the user browser/device.
12. Confirm Scheduler -> SQS -> Step Functions -> AgentCore Runtime reaches a verified terminal run with the device offline and retains the same constrained semantic-recovery behavior while drift remains enabled.
13. Confirm sanitized run history/timeline/reasoning/evidence, optional SES success email, and low-cardinality CloudWatch/EMF telemetry.

## Controlled human-recovery path

Allow the built-in target's short-lived demo auth cookie to expire. Let the next run reach `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, open the secure repair Live View, complete the demo login manually, save the repaired session, and resume. Confirm Browser Profile persistence precedes resume and the post-resume terminal email/metric appears once.

## Stop conditions and evidence

Stop and treat the result as a product defect if tenant/user/profile/credential scope can be chosen by a request, a consequential action advances without verification, duplicate delivery repeats an external effect, SELECT/CHECK/radio state is replayed as generic typing/clicking instead of explicit deterministic primitives, semantic recovery gets an action outside immutable workflow authority, the drift fixture completes without observable semantic recovery when that proof is required, a target security challenge is bypassed, secrets appear in UI/email/logs, retry does not terminate in a bounded state, a Google-federated Cognito user intended for notification evidence is not both Google-linked and email-verified, or Browser networking permits access to infrastructure-local/private control-plane destinations that the deployment intends to block.

Retain only deployment outputs, sanitized run IDs/statuses, selected secret-free logs, and demo screenshots/video. Never retain cookies, OAuth tokens, BYOK keys, workload tokens, Browser Profile contents, Live View credentials, secret-bearing DOM/input values, or hidden model reasoning.
