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
- DynamoDB: users, automations, workflow-version metadata, runs, run steps, locks, credential metadata.
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

Every durable entity is keyed/owned by tenant_id + user_id where appropriate. Browser-profile and secret access are resolved server-side from an authorized automation; clients never choose arbitrary secret/profile identifiers for execution.

## Idempotency/concurrency

- Schedule delivery may be at-least-once; run creation uses an idempotency key based on automation + scheduled occurrence.
- Automation lock prevents overlapping mutable browser runs by default.
- Retryable steps carry attempt IDs and must not duplicate irreversible effects without verification/idempotency support.

## Observability

All services propagate correlation identifiers:
- tenant_id
- automation_id
- workflow_version
- run_id
- node_id
- attempt_id

Do not log cookies, secrets, prompt-private DOM fields, raw API keys, or sensitive browser storage. Run UI receives sanitized reasoning summaries/evidence, not hidden model chain-of-thought.

## Deployment strategy

The repository should support a local/mock mode with the same domain interfaces as AWS integrations. AWS resources remain adapter implementations behind those contracts. Missing credentials must degrade to explicit NOT_CONFIGURED states, never crash imports/builds.
