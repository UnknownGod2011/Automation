# Production Progress

Updated: 2026-08-27

## Current baseline

- `main` is `26273d18ae5da991c8f10a8747b89a4f752f3e20` (`Add deterministic checkbox workflow support`) and is independently green on push CI #374.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, explicit effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.
- GitHub still reports `main` as unprotected. The deployment workflow refuses AWS OIDC credentials unless the exact current `main` head is protected, so repository protection remains an operational prerequisite for the first live AWS deployment.

## This slice — exercise CHECK in the controlled first-party AWS vertical

### Product gap

The provider-neutral deterministic `CHECK` primitive is now production-ready, but the recommended first-party `/demo-target` still exercised only SELECT + TYPE + SUBMIT. The runbook therefore required a separate permitted checkbox page to prove CHECK end to end, weakening the determinism and reproducibility of the first real AWS demonstration.

### Change

- Added one required harmless checkbox, **Confirm this harmless demo action**, to `/demo-target`.
- The demo action accepts completion only when the checkbox posts the single closed confirmation value; missing/forged confirmation fails with the same bounded 400 response as malformed priority/note input.
- The target never reflects or durably stores the checkbox value, priority, or note.
- The protected AWS live smoke now requires the checkbox fixture to exist, submits its fixed confirmation alongside the existing select/note values, and rejects a deployment whose controlled checkbox fixture disappears.
- `docs/AWS_VERTICAL_DEMO.md` now uses one first-party workflow to prove SELECT + TYPE + CHECK + verified SUBMIT together.

## Security / tenant isolation

- The checkbox is a first-party staging/demo fixture only and remains disabled by default with the rest of `/demo-target`.
- No tenant/user authority, Browser Profile reference, session identifier, workflow identifier, credential reference, or execution capability is added to browser requests.
- Capture stores only CHECK's demonstrated boolean state. The target-side fixed form value is not capture authority and is never returned by the completed page.
- Passwords, MFA, target authentication, API keys, tokens, and other secrets remain outside workflow inputs and continue through Browser Profile / BYOK / human-auth boundaries.

## Idempotency / concurrency / retry / timeout

- CHECK execution remains idempotent because production Playwright uses `check()` / `uncheck()` for the desired immutable state rather than toggle-click semantics.
- The previously merged discrete-control event normalization ensures one checkbox click/change interaction yields one executable CHECK event rather than CLICK + CHECK.
- The demo target itself remains stateless and repeatable; a fresh authenticated GET always renders the same starting form.
- No new queue, lease, lock, retry policy, timeout, persistence authority, or recovery state is introduced.

## Side-effect verification / user recovery

- CHECK remains a side-effecting workflow node with mandatory independent selected-state verification before execution may advance.
- The controlled demo now verifies one semantic plan containing explicit SELECT, TYPE, CHECK, and SUBMIT steps; generic CLICK must not replace the SELECT/CHECK state-changing primitives.
- Existing target-auth recovery remains unchanged: after the short-lived demo cookie expires, a later navigation returns 401 and must enter the existing `TARGET_AUTH_REQUIRED` takeover/profile-save/resume path.

## Cost / observability

- No new AWS resource, IAM permission, dependency, AgentCore allocation, model request, Scheduler delivery, DynamoDB/S3 write, or retained GitHub Actions artifact is added.
- The protected smoke adds no extra HTTP round trip beyond the existing controlled action; it only includes the checkbox value in the same form POST and verifies the rendered fixture.
- CHECK action/verification evidence remains metadata-only in production execution, avoiding extra screenshot cost/privacy exposure.

## Regression coverage

- Web target tests prove the authenticated form exposes the checkbox, accepts only the fixed checked confirmation, rejects missing/forged confirmation, and does not reflect submitted values.
- The deployment smoke contract requires the checkbox fixture and sends the fixed confirmation through the same controlled action.
- A negative smoke fixture proves a deployment missing the checkbox cannot pass the protected vertical gate.
- Existing core/AWS CHECK tests continue to prove boolean-only capture, duplicate click/change suppression, compile semantics, idempotent check/uncheck execution, and independent verification.

## Validation

- Incoming `main` (`26273d18ae5da991c8f10a8747b89a4f752f3e20`) is independently green on push CI #374.
- This slice is complete only after GitHub Actions passes on the exact batched head.
- Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, control-plane Lambda packaging, Next.js Lambda packaging, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite.
- No check may be weakened to obtain green CI. A deterministic lock mismatch, if one occurs, requires inspection of the authoritative CI-produced graph before the single permitted corrective commit.

## Known production risks / parked work

- `main` still needs actual GitHub branch/ruleset protection before the deployment workflow will issue AWS credentials.
- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- Radio, file-upload, password, miscellaneous controls, and multi-select remain intentionally unsupported until they receive explicit provider-neutral semantics and verification. Single-select and checkbox are deterministic-only supported controls.
- SELECT semantic recovery remains intentionally disabled because the bound option may be private per-run data; CHECK semantic recovery remains disabled because the captured boolean is immutable deterministic workflow intent.
- VPC Browser route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, promote this slice, configure required GitHub `main` protection, then run the controlled real AWS vertical:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require strengthened live smoke and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. target `${webOrigin}/demo-target`, authenticate in Live View, record **SELECT + TYPE + CHECK + SUBMIT**, finish trusted completion, and inspect capture evidence;
5. Compile and confirm the semantic plan contains one explicit SELECT, TYPE, CHECK, and verified SUBMIT with no duplicate generic CLICK for discrete controls;
6. run a Fresh Test lasting beyond the control-plane HTTP timeout and confirm durable asynchronous completion;
7. approve/publish with recurrence, timezone, and guided explicitly non-secret reusable SELECT/TEXT values;
8. verify EventBridge Scheduler -> SQS -> Step Functions -> AgentCore execution, effect verification, timeline/reasoning/evidence/history, SES, and CloudWatch;
9. let controlled target authentication expire, require `TARGET_AUTH_REQUIRED`, complete secure Live View repair, save the Browser Profile, resume once, and reach terminal success.
