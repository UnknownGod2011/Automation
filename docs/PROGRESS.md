# Production Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `39fe1bf9751d7e0816c497f560e9889f735cb7ea` (`Require protected main before AWS deployment`).
- Push GitHub Actions CI #361 completed successfully on that exact SHA before this slice.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, explicit effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.
- GitHub currently reports `main` as unprotected. The protected deployment workflow now refuses AWS OIDC credentials unless the exact current `main` head is protected, so repository protection remains an operational prerequisite for the first live AWS deployment.

## This slice — actionable unsupported capture controls

### Product defect

Capture deliberately classifies form controls such as checkbox, radio, file, password, and miscellaneous inputs. The compiler correctly fails closed for control types that do not yet have an explicit replay primitive. However, `AutomationControlPlaneService.compileAutomation()` collapsed that intentional compiler refusal into a generic `CONFLICT`, and the authenticated Next.js mutation collapsed it again into a generic request failure. A user could therefore complete a valid cloud capture, press Compile, and receive no useful correction path even though the platform knew the capture contained an unsupported control.

### Change

- The provider-neutral control plane recognizes only the compiler's closed unsupported-control failure shape and converts it to the dedicated sanitized code `UNSUPPORTED_CAPTURE_CONTROL`.
- The control-plane HTTP boundary keeps the existing fail-closed 409 status while preserving that closed code. It does not return the capture event ID, selector, field value, Browser Profile identity, or compiler internals.
- The server-side web client recognizes only that exact closed code. Arbitrary 409 payloads remain generic `CONFLICT`, and upstream error messages are never surfaced.
- Compile mutations encountering the dedicated code redirect to an explicit correction page explaining that compilation stopped before Fresh Test/cloud execution and that the workflow must be reteached with a supported interaction.
- Password/target-site authentication guidance keeps authentication in the persisted Browser Profile rather than suggesting replayable password inputs.
- The compiler itself remains unchanged and fail-closed. Checkbox, radio, file, password, and miscellaneous controls are not approximated with TYPE/CLICK semantics merely to make compilation pass.

## Security / tenant isolation

- Tenant/user authority is unchanged and remains derived from authenticated server context.
- The new public signal is one closed error code only. Internal capture event IDs, selectors, trace IDs, Browser session/Profile references, runtime values, BYOK material, provider errors, and raw compiler messages remain server-side.
- Unknown or malformed 409 responses cannot opt into the special UX; they remain generic conflicts.
- No third-party security control is bypassed. Password controls remain excluded from replay and target authentication remains a human-owned Browser Profile flow.

## Idempotency / concurrency / retry / timeout

- Compilation still creates no workflow version when the compiler rejects an unsupported control.
- Repeating Compile against the same capture produces the same safe refusal and no Browser/model/Scheduler side effect.
- No queue, retry loop, lock, lease, outbox, recovery state, or additional timeout is introduced.
- Existing capture completion authority and compile lifecycle state remain authoritative.

## Side-effect verification / user recovery

- No execution-side effect is added. The failure occurs before Fresh Test or scheduled execution.
- Existing verification requirements for supported CLICK/SUBMIT/TYPE/SELECT nodes are unchanged.
- The user recovery path is product-level reteaching: return to Capture, demonstrate a supported equivalent interaction, finish capture, and Compile again.
- Additional explicit browser primitives should be added only with deterministic execution semantics and verification, not by weakening this gate.

## Cost / observability

- No AWS resource, IAM permission, dependency, AgentCore allocation, OpenAI request, Scheduler delivery, DynamoDB/S3 write, or retained GitHub Actions artifact is added.
- The clearer failure prevents futile Fresh Test cloud spend after a capture the runtime cannot faithfully replay.
- Existing sanitized control-plane logs/metrics remain sufficient; no high-cardinality metric dimension is introduced.

## Regression coverage

- Core tests prove a closed unsupported checkbox/file compiler failure maps to `UNSUPPORTED_CAPTURE_CONTROL` and strips internal event identity.
- Unrelated compiler failures remain generic `CONFLICT` and do not expose internal detail.
- HTTP regression coverage proves the dedicated 409 code is preserved through the authenticated control-plane transport.
- Web-client tests prove only the exact closed code is classified specially; arbitrary 409 responses remain generic and remote messages stay hidden.
- The Next.js Compile mutation routes this condition to a user-facing correction page while all other conflicts retain the existing generic safe failure path.

## Validation

- Normal implementation head `19c8dbcb83bc11cd54c0ab7ad8568578b38a1985` reached CI #362. Deterministic lock verification and frozen installation passed.
- CI #362 then failed at strict core TypeScript checking because the new test fixture's `CaptureSessionStarter` mock widened `kind: "NOT_CONFIGURED"` to `string`. Production code was not implicated.
- The single corrective change keeps the strict contract and annotates only that fixture literal with `as const`; no compiler option or production check is weakened.
- This slice is complete only after GitHub Actions succeeds on the exact corrective head. Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, all three production package builds, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite.

## Known production risks / parked work

- `main` still needs actual GitHub branch/ruleset protection before the deployment workflow will issue AWS credentials.
- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- Checkbox, radio, file-upload, password, miscellaneous controls, and multi-select remain intentionally unsupported until they receive explicit provider-neutral semantics and verification. Single-select remains supported through the explicit deterministic SELECT primitive.
- SELECT semantic recovery remains intentionally disabled because the bound option may be private per-run data; deterministic retry + human escalation is the current safe boundary.
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
4. target `${webOrigin}/demo-target`, authenticate in Live View, record the supported demo workflow, finish trusted completion, and inspect capture evidence;
5. Compile and inspect the semantic plan; unsupported captures must now produce the dedicated correction UX rather than a generic failure;
6. run a Fresh Test lasting beyond the control-plane HTTP timeout and confirm durable asynchronous completion;
7. approve/publish with recurrence, timezone, and any required explicitly non-secret scheduled inputs;
8. verify EventBridge Scheduler -> SQS -> Step Functions -> AgentCore execution, effect verification, timeline/reasoning/evidence/history, SES, and CloudWatch;
9. let controlled target authentication expire, require `TARGET_AUTH_REQUIRED`, complete the secure Live View repair, save the Browser Profile, resume once, and reach terminal success.
