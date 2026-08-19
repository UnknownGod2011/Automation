# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

- Strict TypeScript/pnpm monorepo with versioned workflow/run/failure contracts, bounded retries, checkpointing, verification, occurrence idempotency, and tenant ownership.
- Provider-neutral execution engine plus AWS DynamoDB/S3/AgentCore/Playwright adapters behind explicit ports.
- Explicit `HUMAN` pause -> repair -> resume lifecycle with immutable workflow-version pinning and no guessed human branching.
- Atomic human-resolution claims, durable execution leases, heartbeat fencing, redacted audit history, and AWS conditional persistence.
- Durable first-successor effect reconciliation with stable effect identity and immutable `ALREADY_APPLIED` / `DEFINITELY_NOT_APPLIED` / `AMBIGUOUS` authority.
- Provider-neutral read-only reconciliation coordinator plus AWS observation-only Playwright verifier.
- Pure `planAlreadyAppliedHumanResumeRecovery` checkpoint reconstruction without replaying the external action.
- Lease-owned atomic `ALREADY_APPLIED` recovery transition for run + checkpoint + a create-only durable continuation handoff.
- Crash-recovery admission for replayed same-resolution human commands and a heartbeat-fenced observation-only recovery worker.

## Recent authoritative validation

- CI #123 passed on `0352ad8c27570a0f2930807c12aaf0fa24c1edeb` after correcting one stale test expectation without weakening production behavior.
- CI #124 passed on `2b3ca598355efd61b43832492c727f7125c19f3d` with replay crash-recovery admission.
- CI #125 passed on `6b0df3506d84bb1c5623c2c45cd0d3f084405b1e` with heartbeat-fenced observation-only crash reconciliation.
- CI #126 passed on `eaa3b1b15883eb45d7af28a71fe11eecf5753201` with the atomic continuation handoff.
- The execution container cannot resolve GitHub/npm directly, so no local install/check/test pass is claimed. GitHub Actions on the exact published head remains authoritative.

## 2026-08-19 — Build reproducibility and dependency hygiene

### Why this slice is first

The recovery subsystem now has a durable crash-safe continuation handoff. Per product priority, further continuation-consumer hardening is deferred until an end-to-end vertical slice actually needs it. The next blocking foundation issue is reproducibility: CI currently resolves dependencies without a checked-in lockfile, and CI #126 showed a concrete AWS SDK peer mismatch.

### Changes in this slice

- Pin root `typescript` and `vitest` versions to the exact versions already resolved by the last authoritative green CI instead of caret ranges.
- Align direct DynamoDB client compatibility by moving `@aws-sdk/client-dynamodb` to `3.1111.0`, satisfying the peer requirement emitted by the currently resolved `@aws-sdk/util-dynamodb` dependency instead of suppressing the warning.
- Replace the permissive CI install with a lockfile bootstrap gate: pnpm 10.15.0 resolves `pnpm-lock.yaml`, prints it into the job log without uploading an Actions artifact, and fails if the resulting lockfile is missing or differs from the checked-in repository state.
- Once that gate produces the authoritative lockfile, the single allowed corrective commit for this run will check in that exact file and switch CI to `pnpm install --frozen-lockfile`.

### Security / tenancy / side effects

- This slice changes dependency resolution and CI only. It does not change browser execution authority, tenant scoping, credential storage, retry semantics, schedules, external side effects, or user recovery behavior.
- No new package, secret, artifact upload, or runtime permission is introduced.
- Printing `pnpm-lock.yaml` in the temporary bootstrap CI log exposes package metadata only; it contains no repository or user secrets.

### Cost / observability / operations

- No new Actions artifacts are produced, avoiding additional Actions artifact-storage pressure.
- Frozen installs should reduce nondeterministic dependency drift and make future CI failures attributable to source changes rather than unrecorded registry resolution.
- The lockfile becomes the authoritative dependency graph; package manifests remain exact for intentionally managed top-level versions.

### Validation status

- Incoming head `eaa3b1b15883eb45d7af28a71fe11eecf5753201` is confirmed green via CI #126.
- The exact new head is not considered validated until its GitHub Actions result exists.
- A first CI failure solely because the newly enforced lockfile is not yet checked in is expected and will be used to capture the exact pnpm-generated lock for the one permitted corrective commit. Any other failure must be root-caused before changing code.

### Next product milestones after reproducibility is green

1. Define capture trace/event contracts with bounded semantic target metadata, artifact references, and tenant ownership.
2. Add a provider-neutral compiler that converts realistic capture fixtures + objective into a validated semantic `WorkflowGraph`.
3. Build a local/mock vertical slice covering create -> capture fixture -> compile -> test -> approve/publish -> scheduled dispatch -> execution -> run history without cloud credentials.
4. Add control-plane service/API contracts and a minimal Next.js dashboard/create/capture/test/publish UX.
5. Add AWS scheduling/dispatch adapters and IaC, then real AgentCore Live View/capture integration behind existing ports.
6. Implement BYOK credential-pool routing, notifications/observability, and one controlled human-recovery demo.

## Recovery boundary intentionally parked

The current recovery continuation record is a durable handoff, not action authority. A future continuation consumer must remain idempotent before automatic post-reconstruction execution is enabled. `AMBIGUOUS` remains human-attention only, and `DEFINITELY_NOT_APPLIED` remains non-executable until an explicit proof-of-absence/idempotency contract exists. No additional recovery micro-hardening should preempt the product milestones above unless CI or an end-to-end slice exposes a concrete correctness defect.
