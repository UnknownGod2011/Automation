# Architecture

## Boundary rule

The web application is a control plane. Scheduled automation execution is a separate execution plane. User devices may disconnect at any point after a workflow is published.

## Control plane

### Web UI
- Next.js/TypeScript.
- Cognito-backed Google/email authentication.
- Never receives long-lived target-site credentials or raw provider keys after submission.

### API service
Owns automation CRUD, workflow versioning, schedules, credential metadata, run inspection, and human-resolution commands.

### Persistence
- DynamoDB: users, automations, workflow-version metadata, runs, run steps, locks, human-resolution claims, human-resume execution leases, human-resume effect reconciliation, credential metadata.
- S3: capture recordings, screenshots, DOM/event artifacts, compiled workflow documents, run evidence.
- Browser Profiles: target-site session state.
- AgentCore Identity: provider credential secrets/references.

## Execution plane

EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard.

Step Functions is the durable source of truth for a run. Agent/model/browser processes are workers, not workflow owners.

### Preflight
1. Idempotently create/claim run.
2. Confirm automation is ACTIVE.
3. Acquire automation concurrency lock.
4. Load immutable published workflow version.
5. Confirm a usable reasoning provider credential/configuration.
6. Validate browser-profile reference and policy.

### Execution
1. Create isolated AgentCore Browser session.
2. Restore Browser Profile.
3. Connect deterministic browser executor through Playwright/CDP.
4. Execute workflow nodes.
5. For every node, produce structured attempt/effect evidence.
6. If deterministic execution cannot satisfy a node, invoke the semantic reasoner with constrained context and allowed actions.
7. Validate any reasoning decision against the node's declared action boundary before giving it to the browser executor.
8. Verify resulting state before advancing.
9. Bind declared node outputs into durable workflow variables.
10. Checkpoint after every meaningful effect and before any retry/pause boundary.

Semantic recovery is only a fallback for recoverable UI ambiguity such as element drift or failed effect verification. It is not used to reinterpret authentication, quota, policy/security, or explicit human-decision failures.

For a node with one successor, control flow advances directly. For a node with multiple declared successors, the executor/reasoner must produce `nextNodeId`, and the engine accepts it only when it exactly matches one of those declared successors. This keeps branching inside the immutable workflow graph rather than permitting model-selected arbitrary destinations.

### Completion
- Persist final run state and evidence.
- Save allowed browser-profile changes.
- Release lock.
- Send optional success email.
- Terminate ephemeral compute.

### Failure / human intervention
Failures are classified, not blindly retried.

Typical classes:
- TRANSIENT_NETWORK
- PROVIDER_RATE_LIMIT
- PROVIDER_AUTH_INVALID
- PROVIDER_QUOTA_EXHAUSTED
- TARGET_AUTH_REQUIRED
- ELEMENT_NOT_FOUND
- EFFECT_NOT_VERIFIED
- POLICY_BLOCKED
- HUMAN_DECISION_REQUIRED
- UNKNOWN

Each workflow state has a retry budget and fingerprint. Retry delays use bounded exponential backoff; jitter is injected by the runtime so retry planning remains deterministic and testable. Repeated unresolved fingerprints open a human-intervention circuit even when nominal attempts remain, preventing infinite retries against an unchanged page state.

A durable checkpoint contains the current node, completed nodes, attempt count, state fingerprint/repeat count, workflow variables, accumulated evidence references, and the last classified failure. This is the minimum recovery state required to terminate browser/model compute while waiting for a human and later reconstruct execution from the same immutable workflow version.

Persist checkpoint + evidence, save browser profile, terminate browser, notify owner. Resume later in a new browser session reconstructed from checkpoint/profile. Human resume resets the failed-attempt/fingerprint circuit for the repaired node while retaining durable workflow variables and prior evidence.

An explicit `HUMAN` workflow node is a durable pause boundary. Until human branch-selection output is represented as an explicit typed resolution command, resuming an explicit `HUMAN` node requires exactly one declared successor. The engine validates that successor before changing the persisted run out of `WAITING_FOR_HUMAN`, marks the human node completed, checkpoints the declared successor, clears the human failure/fingerprint circuit, and preserves the run's immutable workflow version, variables, and prior evidence. Ambiguous human control flow is rejected rather than guessed.

Human-resolution delivery is at-least-once. A resolution command is scoped to tenant + user + run + paused node and carries a stable resolution ID. Durable cloud adapters must atomically accept exactly one resolution ID for that pause boundary. The AWS adapter uses a conditional DynamoDB put; a losing writer performs a strongly consistent read and resolves to `REPLAY` only when the winning resolution ID matches, otherwise `CONFLICT`. Transport/throttling failures are not converted into duplicate outcomes. Claim acceptance is intentionally cheaper than browser/model startup so duplicate delivery can be rejected before execution-plane cost or side effects.

`HumanResumeOrchestrator` is the provider-neutral production command boundary between durable human-resolution claims and resume execution. `REPLAY` and `CONFLICT` remain explicitly non-executing. A newly `ACCEPTED` claim must additionally acquire a durable human-resume execution lease before browser/model work may start. The lease is scoped to tenant + user + run + paused node + resolution ID and is owned by an opaque worker token with an expiry. Completion is a durable tombstone, not lease deletion.

The AWS lease adapter uses conditional DynamoDB writes so only one live owner exists. An expired lease may be reacquired only for the same resolution ID; a competing resolution ID is a permanent conflict. Renewal and completion use conditional owner/resolution/state/expiry checks, and non-conditional DynamoDB uncertainty propagates instead of being guessed. Reads used to classify contention are strongly consistent.

Healthy human-resume execution uses a provider-neutral heartbeat in addition to checkpoint-coupled renewal. Timer-driven and boundary-driven renewals are serialized so an older renewal response cannot regress the worker's current lease. Browser session creation, runtime creation, deterministic browser actions, semantic reasoning, semantic browser actions, verification, checkpoint writes, and profile persistence are fenced by the same heartbeat. If any renewal is rejected or uncertain, that worker permanently considers ownership lost and no later ownership-sensitive operation may start. Cleanup may still close that worker's own ephemeral runtime/session because cleanup cannot create external workflow effects.

The heartbeat interval must be positive and strictly smaller than the lease TTL. The default is approximately one third of the TTL, providing multiple renewal opportunities during long browser/model calls while bounding DynamoDB write amplification. A heartbeat cannot cancel an external side effect already in flight at the exact moment ownership becomes uncertain; after the call returns, its result is rejected and all subsequent workflow effects are fenced. Automatic crash replay therefore remains disabled until effect reconciliation can determine whether an in-flight external effect already happened.

Human-resume effect reconciliation is a separate durable authority for that unknown-side-effect window. Before automatic crash recovery can be enabled, the first resumed successor must have one stable effect identity scoped to tenant + user + run + paused HUMAN node + successor node + resolution. Production storage must atomically prepare exactly one identity for that pause boundary and later atomically persist exactly one immutable reconciliation decision. The only decisions are `ALREADY_APPLIED`, `DEFINITELY_NOT_APPLIED`, and `AMBIGUOUS`.

Only `DEFINITELY_NOT_APPLIED` can ever authorize an automatic retry of the external effect. `ALREADY_APPLIED` means the replacement worker must advance by reconstructing/verification rather than replaying the action. `AMBIGUOUS` is a fail-closed human-recovery state: the platform must not guess whether to repeat the effect. Reconciliation persistence is execution authority, unlike best-effort audit history; throttling, transport failure, or conditional-write uncertainty must propagate rather than be translated into any decision.

`HumanResumeEffectVerifier` is the provider-neutral read-only runtime inspection boundary for reconciliation. It may inspect current browser/page state and use bounded reasoning, but it must never execute the successor or any other external side effect. It receives the immutable successor node plus its declared verification contract and must return one of the same three decisions. `DEFINITELY_NOT_APPLIED` is a proof obligation: if absence cannot be established, the verifier must return `AMBIGUOUS`.

`HumanResumeEffectReconciler` prepares the durable identity before invoking the verifier, rejects identity conflicts before inspection, and treats an existing durable decision as authoritative without re-inspecting runtime state. Verifier failure leaves the effect in `PREPARED` state; it does not manufacture a decision. Concurrent read-only inspections are permitted, but the durable conditional decision write serializes authority, so at most one decision wins. This slice still does not enable automatic worker replay; lease reacquisition and successor control flow must consume this authority in a later integration.

This lease does not by itself make crash replay safe. Current orchestration still treats a claim `REPLAY` as non-executing even if a prior lease later expires. If the accepted executor crashes, the active lease is left to expire and the run requires a future recovery policy. Automatic reacquisition/re-execution must remain disabled until the executor can reconcile the unknown-side-effect window using node-level verification/idempotency. Lease ownership prevents concurrency; it does not prove whether an external side effect happened just before a worker died.

Worker owner tokens are operational capability material. They may be persisted inside the lease record for compare-and-set ownership, but must not be exposed to clients, user-visible run history, heartbeat errors, or logs.

## Workflow intermediate representation

The compiler emits a versioned DAG/state graph rather than generated one-off Playwright code.

Initial node kinds:
- NAVIGATE
- CLICK
- TYPE
- EXTRACT
- REASON
- CONDITION
- LOOP
- VERIFY
- WAIT
- DOWNLOAD
- UPLOAD
- HUMAN
- SUBFLOW
- END

Every executable node includes:
- stable node id
- objective/intent
- deterministic strategy candidates
- input/output bindings
- allowed side effects
- expected effect / verification criteria
- timeout
- retry policy
- escalation policy

Nodes that declare side effects must also declare a verification contract. Invalid retry backoff bounds and graph references are rejected at the workflow-contract boundary rather than deferred to runtime.

## Capture architecture

Capture occurs in the same cloud-browser class used for execution.

Signals retained during capture:
- navigation events
- click/input/scroll/submit events
- semantic target data (role/name/text/test ids/selectors where available)
- URL and page identity
- screenshots around meaningful actions
- relevant DOM/accessibility snapshots
- resulting page changes/effects
- optional browser recording
- optional uploaded demonstration video

The compiler combines capture evidence with the user's stated objective. Video is supplementary, not the only source of truth.

## Model/provider abstraction

Reasoning calls go through a provider router interface. Workflows never contain provider-specific SDK calls.

BYOK v1:
- raw keys stored through secure secret/token-vault integration, not DynamoDB
- metadata stores provider, credential reference, masked label, health, priority, cooldown, last success
- transient errors use bounded exponential backoff with jitter
- authentication failures disable that credential
- quota exhaustion marks it unavailable
- alternate credentials may be selected only according to explicit provider/user policy; key rotation is not used to evade service limits

Future managed-model mode implements the same router interface.

## Multi-tenancy and authorization

Every durable entity is keyed/owned by tenant_id + user_id where appropriate. Browser-profile and secret access are resolved server-side from an authorized automation; clients never choose arbitrary secret/profile identifiers for execution. Human-resolution claims, resume execution leases, and effect-reconciliation records use the same ownership partition and validate embedded ownership identity when read.

## Idempotency/concurrency

- Schedule delivery may be at-least-once; run creation uses an idempotency key based on automation + scheduled occurrence.
- Automation lock prevents overlapping mutable browser runs by default.
- Retryable steps carry attempt IDs and must not duplicate irreversible effects without verification/idempotency support.
- Human-resolution command delivery may be duplicated or concurrent; exactly one resolution ID may be durably accepted for a given ownership + run + paused-node boundary.
- Human resume execution is started only for a newly accepted claim that also owns a live execution lease; replay/conflict outcomes do not start browser/model work.
- Human-resume heartbeat and boundary renewals share one serialized renewal path; once ownership is lost, the worker may not initiate another browser/model/verifier/checkpoint/profile operation.
- A human-resume pause boundary may have only one prepared first-successor effect identity. Same-identity preparation is replay; a different effect/resolution/successor identity is conflict.
- A prepared human-resume effect may receive only one immutable reconciliation decision. Same-decision delivery is replay; a competing decision is conflict.
- Reconciliation inspection is read-only. Identity conflict and prior durable decision suppress inspection; verifier/storage uncertainty never grants retry permission.
- Automatic external-effect retry is permitted only from a durable `DEFINITELY_NOT_APPLIED` decision. `ALREADY_APPLIED` and `AMBIGUOUS` are non-retrying outcomes.
- Lease expiry permits same-resolution ownership recovery at the storage-contract level, but orchestration must not convert that into automatic side-effect replay until effect reconciliation is fully wired into runtime verification and successor control flow.

## Observability

All services propagate correlation identifiers:
- tenant_id
- automation_id
- workflow_version
- run_id
- node_id
- attempt_id

Do not log cookies, secrets, prompt-private DOM fields, raw API keys, sensitive browser storage, or human-resume lease owner tokens. Run UI receives sanitized reasoning summaries/evidence, not hidden model chain-of-thought. Heartbeat ownership-loss errors must remain sanitized and must not include the durable lease payload or owner token. Reconciliation records store only bounded identity/timestamps/state/decision; browser content and exception text remain outside this execution-authority record. Reconciliation verifier evidence is referenced by artifact ID rather than embedded into the execution-authority record.

## Deployment strategy

The repository should support a local/mock mode with the same domain interfaces as AWS integrations. AWS resources remain adapter implementations behind those contracts. Missing credentials must degrade to explicit NOT_CONFIGURED states, never crash imports/builds.
