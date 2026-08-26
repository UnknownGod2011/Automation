# Automation Platform Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `0cb259e1cb26e33b3203372658dee08009b6a866` (`Add explicit single-select workflow support`).
- Push GitHub Actions CI #357 completed successfully on that exact SHA before this slice.
- The AWS-first vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — exercise SELECT in the controlled AWS vertical

### Product gap

The platform now has an explicit deterministic `SELECT` workflow primitive, but the controlled first-party `/demo-target` still exercised only text input plus native submit. The first protected AWS deployment therefore had no deterministic target proving Capture -> Compile -> runtime-input configuration -> SELECT execution -> verification on a site we own.

### Change

- The controlled demo workflow now contains one ordinary single-select **Priority** field with the closed values `low`, `normal`, and `high`, plus the existing non-secret note and native submit action.
- The target validates priority and note before returning its stable completion state. Neither submitted value is reflected or persisted by the demo target.
- The demo instructions require changing the select from **Normal priority** to **High priority** during capture so a real browser change event is recorded.
- The captured selected option continues through the existing unresolved `capture_input_N` boundary; it is not written into the capture trace. Fresh Test and scheduled execution use the existing sanitized runtime-input/non-secret scheduled-input product paths.
- The protected live smoke now requires the deployed authenticated demo page to expose the SELECT fixture and expected controlled option, submits both priority and note, and rejects a response that reflects either input.
- The no-cloud smoke contract includes a negative case where the demo target is live but the SELECT fixture is missing.
- `docs/AWS_VERTICAL_DEMO.md` now makes SELECT inspection/testing part of the first controlled vertical rather than a later ad-hoc compatibility check.

## Security / tenant isolation

- The demo priority is a fixed non-secret allowlist and is never a tenant, automation, Browser Profile, credential, trace, run, or workflow authority.
- The target keeps no durable application data and does not reflect submitted priority/note values into the completion page.
- The selected label is still excluded from the capture trace and reaches execution only through the existing tenant/user-scoped runtime-input boundary.
- BYOK keys, cookies, Browser Profile contents, Live View capability material, workload tokens, and provider errors are unaffected.

## Idempotency / concurrency / retry / timeout

- No new queue, retry loop, lock, lease, outbox, recovery state, or cloud write is introduced.
- SELECT execution remains exactly-once per node attempt at the browser primitive and is followed by explicit selected-state verification.
- Existing automation locks, scheduled occurrence idempotency, bounded node retries, collector readiness, and submit normalization remain authoritative.
- The live smoke adds only bounded web-Lambda requests; it cannot create automations, Browser sessions, model work, schedules, or user state.

## Side-effect verification / user recovery

- The SELECT node must still satisfy `capture:select-bound-value` verification before execution advances.
- Native submit remains one verified SUBMIT action; the controlled target's stable completion page remains the structural post-effect evidence.
- Target authentication expiry still exercises the existing `TARGET_AUTH_REQUIRED` -> secure Live View repair -> Browser Profile save -> idempotent resume path.

## Cost / observability

- No AWS resource, IAM permission, dependency, table/index, bucket, AgentCore allocation, OpenAI call, Scheduler delivery, or retained Actions artifact is added by this slice.
- Live smoke adds one additional form field to requests it already makes; cost impact is negligible.
- The controlled vertical now proves an additional common web primitive before broad arbitrary-site testing, reducing wasted Fresh Test/debug cost when SELECT support regresses.

## Regression coverage

- Web tests prove the authenticated target contains the controlled select/options and rejects missing/forged priority values.
- Web tests prove successful completion does not reflect submitted note or priority.
- Deployment-smoke contracts require the select fixture and submit both controlled inputs.
- A negative smoke regression proves a deployed demo page missing the SELECT fixture fails the protected gate.
- Existing compiler/AWS tests remain responsible for SELECT compilation, exactly-one deterministic selection, no post-selection screenshot, and selected-state verification.

## Validation

This slice is complete only after GitHub Actions succeeds on the exact published head. Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, all three production package builds, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite. Never weaken these checks to obtain green status.

## Known production risks / parked work

- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- Checkbox, radio, file-upload, password, miscellaneous controls, and multi-select remain intentionally unsupported until they receive explicit provider-neutral semantics and verification.
- SELECT semantic recovery remains intentionally disabled because the bound option may be private per-run data; deterministic retry + human escalation is the current safe boundary.
- VPC Browser route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Repository-level `main` protection remains an operational prerequisite before the first production AWS deployment (Issue #29).
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, promote this slice, protect the trusted `main` boundary, then run the controlled real AWS vertical:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require strengthened live smoke and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. target `${webOrigin}/demo-target`, authenticate in Live View, wait for authoritative collector readiness, change Priority to **High priority**, type a non-secret note, submit once, finish trusted completion, and inspect capture evidence;
5. compile/inspect and require one SELECT + one TYPE + one verified SUBMIT; run a >30-second Fresh Test with the displayed runtime inputs and inspect timeline/reasoning/evidence;
6. publish a near-future recurrence/timezone with the same values configured through the explicitly non-secret scheduled-input boundary and verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime while the user device is offline;
7. let demo auth expire, verify `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that live environment over speculative recovery hardening.
