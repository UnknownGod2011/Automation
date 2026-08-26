# Automation Platform Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `819151947176c5d3d058fc0a159863a9bcd3395f` (`Make capture collector readiness authoritative`).
- Push GitHub Actions CI #353 completed successfully on that exact SHA before this slice.
- The AWS-first product vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized run timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install; AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — fail closed on unsupported captured form controls

### Product correctness defect

The production Playwright collector observed `change` events from text inputs, textareas, selects, checkboxes, radios, file inputs, and other HTML input types, but discarded the browser control type when persisting `CaptureEvent`. The provider-neutral compiler consequently treated every captured INPUT as a `TYPE` node, while the AWS Playwright TYPE executor uses `locator.fill()`.

That is correct for text-like controls but wrong for selects, checkboxes, radios, file inputs, and password/authentication inputs. A real capture could therefore compile into an executable graph that cannot faithfully replay what the user demonstrated. This is Capture -> Compile -> Fresh Test product correctness, not recovery hardening.

### Change

- Capture contracts now carry optional closed `inputControl` metadata: `TEXT`, `SELECT`, `CHECKBOX`, `RADIO`, `FILE`, `PASSWORD`, or `OTHER`.
- The AgentCore Playwright collector classifies the observed browser control before persisting an INPUT event. Raw values remain excluded exactly as before.
- The compiler permits `TEXT` controls and legacy traces without control metadata, preserving existing immutable trace compatibility.
- The compiler fails closed on newly captured non-text controls rather than miscompiling them as TYPE. This deliberately does not pretend the runtime supports select/check/file/password semantics yet.
- Supporting those controls later should add explicit provider-neutral action semantics plus deterministic/semantic execution and verification; it must not be approximated with generic typing.

## Security / tenant isolation

- `inputControl` records only a bounded control category. It contains no field value, selector value beyond existing semantic target metadata, DOM/page contents, Browser Profile/session identity, Live View capability, BYOK material, workload token, provider error, or user secret.
- Password controls are explicitly classified and refused by compilation for workflow replay; target-site authentication remains in the persisted Browser Profile and human auth/takeover flow.
- Tenant/user/automation/capture authority remains unchanged and server-owned.

## Idempotency / concurrency / retry / timeout

- No new write authority, queue, retry loop, timeout layer, lock, lease, or recovery state is introduced.
- Capture event ordering/idempotency and collector readiness are unchanged.
- Unsupported controls fail before Fresh Test/browser/model execution, avoiding an impossible replay rather than retrying it.

## Side-effect verification / user recovery

- Existing CLICK/SUBMIT structural verification and INPUT verification remain unchanged.
- Unsupported controls cannot reach execution, so verification cannot accidentally authorize a mismatched action.
- The user recovery path is correction-oriented: revise the demonstration or wait for an explicit supported control primitive; no hidden fallback broadens browser authority.

## Cost / observability

- No AWS resource, IAM permission, dependency, DynamoDB table/index, S3 bucket, AgentCore allocation, OpenAI call, Scheduler delivery, or retained Actions artifact is added.
- Failing at Compile avoids wasted AgentCore Fresh Test/model/browser cost for workflows the runtime cannot faithfully replay.
- Future UI work can use the bounded compiler error to explain unsupported controls without exposing values or internal identities.

## Regression coverage

- Compiler coverage proves captured `SELECT` input fails closed instead of becoming a TYPE node.
- Compiler coverage proves legacy text-input traces without `inputControl` remain compatible.
- AWS coverage proves fill-compatible text controls classify as `TEXT` and select/checkbox/radio/file/password/other controls retain distinct non-text categories.
- Existing capture privacy guarantees remain: raw input values are not persisted and INPUT screenshots remain suppressed.

## Validation

This slice is complete only after GitHub Actions succeeds on the exact published head. Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, all three production package builds, all AWS deployment/security/demo/OIDC contracts, and the complete test suite. Never weaken these checks to obtain green status.

## Known production risks / parked work

- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- Select, checkbox, radio, file-upload, and other non-text form controls remain intentionally unsupported by the semantic workflow IR/runtime; they now fail honestly instead of miscompiling.
- VPC Browser route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Repository-level `main` protection remains an operational prerequisite before the first production AWS deployment (Issue #29).
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, promote this slice and run the controlled real AWS vertical:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require strengthened live smoke and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. target `${webOrigin}/demo-target`, authenticate in Live View, wait for authoritative collector readiness, demonstrate the text note + native submit flow, finish trusted completion, and inspect evidence;
5. compile/inspect and run a >30-second Fresh Test, verifying timeline/reasoning/evidence and SUBMIT-only semantic recovery;
6. publish a near-future recurrence/timezone and verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime with the user device offline;
7. let demo auth expire, verify `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that live environment over speculative recovery hardening. If live sites require select/checkbox/radio support, implement those as explicit workflow primitives rather than weakening the TYPE contract.
