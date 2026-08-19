# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

- Strict TypeScript/pnpm monorepo with versioned workflow/run/failure contracts, bounded retries, checkpointing, verification, occurrence idempotency, tenant ownership, and in-memory adapters.
- Provider-neutral execution engine plus AWS DynamoDB/S3/AgentCore/Playwright adapters behind explicit ports.
- Explicit `HUMAN` pause -> repair -> resume lifecycle with immutable workflow-version pinning, conditional human-resolution claims, durable execution leases, heartbeat fencing, redacted audit history, read-only crash reconciliation, and atomic already-applied recovery primitives. Recovery micro-hardening remains parked unless an end-to-end slice or CI exposes a concrete defect.
- Build inputs are pinned to validated TypeScript/Vitest/AWS SDK versions. CI uses Node 22.23.2 and pnpm 10.15.0, regenerates the dependency lock snapshot with lifecycle scripts disabled, authenticates its reviewed SHA-256, and only then performs a frozen install.
- Capture contracts distinguish `AUTH_SETUP` from executable `WORKFLOW` events and keep authentication setup out of scheduled workflow compilation.
- `compileCaptureTrace` emits semantic `WorkflowGraph` definitions, ranks deterministic selectors first, requires verification for side effects, omits scroll noise, synthesizes fresh-run navigation when required, and emits non-sensitive public literals as graph `initialVariables`.
- `AutomationProductLifecycleService` proves the local/mock create -> capture -> compile -> fresh test -> publish -> scheduled dispatch -> execution -> history lifecycle without cloud credentials.
- `AutomationControlPlaneService` and `AutomationControlPlaneHttpHandler` expose sanitized provider-neutral dashboard/API contracts with explicit `CONFIGURED`, `LOCAL_MOCK`, and `NOT_CONFIGURED` capability states.

## Authoritative incoming validation

- CI #132 passed on `ab2734265de1df94469634c8278fe98d81d4e1e6` with deterministic lock verification, frozen install, `pnpm check`, and `pnpm test` all successful.
- PR #1 remains the open draft development PR on `agent/bootstrap-platform`.

## 2026-08-19 — Local/mock product lifecycle vertical slice

`AutomationProductLifecycleService` composes repositories, compiler, execution engine, scheduler port, occurrence coordinator, browser-profile state, and lock state into a credential-free local lifecycle. It requires explicit authorization/consent, validates capture ownership and profile identity, seeds graph initial/runtime variables into the first durable checkpoint, requires the latest fresh-tested workflow before publish, validates IANA timezones, and suppresses duplicate schedule delivery before browser effects execute.

## 2026-08-19 — Control-plane service and HTTP boundary

The lifecycle is exposed through provider-neutral service and HTTP contracts covering dashboard/list, automation detail/create, capture start, trusted trace ingestion, compile, fresh test, publish, and run history. Tenant/user ownership comes only from trusted authenticated context; request JSON cannot select ownership. Server-owned browser-profile references are excluded from UI DTOs. Unexpected errors are mapped to fixed sanitized responses. Capture remains an explicit port and returns `NOT_CONFIGURED` until AgentCore Live View is wired.

## 2026-08-19 — Self-contained deterministic lock bootstrap

`scripts/materialize-pnpm-lock.sh` removed the dependency on a retained historical Actions log. It runs pinned pnpm with lifecycle scripts disabled, regenerates the graph, checks the exact reviewed SHA-256, verifies the known compatible DynamoDB/util-DynamoDB peer resolution, and then CI performs a frozen install. Dependency changes intentionally fail this gate until the new graph hash is reviewed and committed.

## 2026-08-19 — Next.js product dashboard and workflow UX

### Product slice

Added `apps/web`, the first actual user-facing application. It uses the Next.js App Router and renders:

- dashboard with automations, schedule, latest run, attention state, and explicit capability state;
- create-automation form for name, website URL, objective, consent, and notification preferences;
- automation detail screen with capture, compile, fresh-test, approve/publish, recurrence/timezone, and run-history flows;
- explicit empty/`NOT_CONFIGURED` states instead of fabricated cloud data.

The web application speaks only to the existing control-plane HTTP contract. The bearer credential and control-plane base URL are read exclusively from server environment (`AUTOMATION_CONTROL_PLANE_URL`, `AUTOMATION_CONTROL_PLANE_BEARER_TOKEN`) and are never emitted into browser JavaScript or form fields. Non-local control-plane endpoints must use HTTPS.

Mutation forms post only to same-origin Next route handlers. The handlers reject cross-origin/unknown-origin requests, generate automation IDs server-side, pass no tenant/user fields, and redirect using fixed notice codes so upstream/provider exception text cannot enter URLs. The capture command accepts a Live View destination only from the trusted control plane and requires HTTPS before redirecting the user.

### Correctness / security / tenancy / concurrency / cost review

- The UI cannot choose tenant/user ownership, browser-profile references, or provider credentials; those remain server/control-plane responsibilities.
- No target-site password, cookie, API key, browser profile, or runtime secret is persisted by this web slice. Runtime-variable JSON is forwarded only to the fresh-test command and is not reflected back into the UI.
- Existing control-plane publish/test gates, occurrence idempotency, execution locks, bounded retries, verification, and human recovery remain authoritative; the web proxy does not duplicate those state machines.
- Form retries can still duplicate generic create/compile/test/publish HTTP commands under network uncertainty because durable request-idempotency keys are not yet part of the public API. Automation creation mitigates accidental collision with a server-generated UUID, but this is not claimed as generic command idempotency.
- The web application adds no browser/model sessions and therefore no execution-plane cost. It adds ordinary Next.js server/render traffic only.
- Capture/compile UX currently asks for the server-issued trace ID because the automation summary contract does not yet expose capture-completion metadata. AgentCore capture wiring should replace that manual bridge with a trusted durable capture-state pointer.
- Cognito is not faked. Until authentication middleware is configured, the dashboard shows `NOT_CONFIGURED`; the current bearer-token environment contract is a server-side integration seam for the existing control-plane API.

### Dependencies / reproducibility

- Added Next.js `16.2.12` and React/React DOM `19.2.7`, plus pinned TypeScript declaration packages. Next.js is part of the architecture target rather than an optional UI library.
- The incoming lock hash remains intentionally unchanged in the first product commit. CI is expected to stop at the lock-drift gate and print the newly generated SHA-256. That failure is the dependency-review mechanism, not permission to bypass the gate. One corrective commit may update only the reviewed lock hash (and any real code/type defect proven by CI logs), after which the exact corrective head must pass the full frozen install, `pnpm check`, and `pnpm test` suite before this slice is called green.

### Tests

- Added web-client tests proving no network call/fake data when the control plane is unconfigured, server-only bearer forwarding, automation-ID path encoding, upstream-error sanitization, and rejection of insecure non-local control-plane URLs.
- Added mutation-security tests proving same-origin enforcement and fixed redirect-notice codes.
- Added view-model tests for draft/published/attention presentation, schedule formatting without guessed next-run times, and run-status tones.
- `next build` is part of the workspace build, so the production App Router tree is also compiled during the root test command after dependency installation.

### Validation status

- Incoming head `ab2734265de1df94469634c8278fe98d81d4e1e6` is green via CI #132.
- This Next.js slice is not considered validated until GitHub Actions completes on the exact new head. The first run is expected to fail closed at the reviewed lock-hash gate because the dependency graph changed; its reported actual hash must be inspected before the single corrective commit.

## Next product milestones

1. Finish exact-head CI validation of the Next.js slice by reviewing the dependency snapshot produced by the lock gate; do not weaken the gate.
2. Add AWS scheduling/dispatch adapters and IaC (EventBridge Scheduler + SQS + durable orchestration or a justified equivalent), preserving occurrence idempotency, automation locking, queue backpressure, timezones, bounded retry behavior, and explicit `NOT_CONFIGURED` deployment states.
3. Wire AgentCore Live View/capture and real browser-profile restore/save behind `CaptureSessionStarter` and existing browser/profile ports; persist capture-completion metadata so users never manually enter trace IDs.
4. Replace the temporary server bearer integration seam with Cognito authentication/API authorization, then implement BYOK credential-pool routing through the secure secret boundary.
5. Add SES/observability and one controlled end-to-end human-recovery demonstration.

## Known parked limitations

- Recovery continuation consumption stays parked until the cloud worker needs it; do not spend product cycles on narrower recovery edge cases first.
- Sensitive runtime values require the later secret-resolution contract; do not place provider keys, passwords, cookies, or equivalent secrets in ordinary workflow/runtime-variable metadata.
- Workflow publication is represented by the automation's immutable `publishedWorkflowVersion` pointer; the persisted tested graph is not rewritten merely to add publication metadata.
- The local/mock scheduled path does not restore/save a real browser profile or create cloud browser compute; those semantics remain in the production worker/AWS adapter path.
- Public HTTP command idempotency, Cognito token verification, rate limiting, and capture callback authentication remain required production control-plane work.
