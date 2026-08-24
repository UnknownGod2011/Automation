# Production Progress

## Current production state

The AWS-first cloud browser automation vertical has been promoted to `main` as squash commit `c4e3964e2b8e6060b477b7fb60742fd5d0b3765c` (`Build production cloud browser automation platform`). The platform covers the end-to-end lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless a real end-to-end defect requires it. The next product milestone is the protected real AWS deployment and controlled vertical demonstration.

## Incoming validation

- `main` currently points to `c4e3964e2b8e6060b477b7fb60742fd5d0b3765c`.
- The exact pre-merge PR content was validated by GitHub Actions CI #279 before squash promotion.
- CI is configured to run again on direct pushes to `main`; no post-merge CI pass is claimed here unless GitHub surfaces a completed run for the exact merge SHA.
- Exact-head GitHub Actions remains authoritative for the change below.

## This production slice — immutable GitHub Action dependencies

### Deployment/security defect

The source package graph is reviewed through the deterministic pnpm lock gate, but both GitHub workflows still referenced external Actions through mutable tags such as `actions/checkout@v4` and `aws-actions/configure-aws-credentials@v6.2.3`.

That is especially material in the protected AWS deployment workflow: the configure-credentials Action receives GitHub OIDC token capability and then installs short-lived AWS credentials into the job. A mutable upstream tag could change without any repository diff, undermining the otherwise immutable release/deployment model.

### Behavior

- CI and protected AWS deployment now pin every external GitHub Action to a full 40-character commit SHA.
- Readable version comments remain beside each pin so maintainers can intentionally review upgrades.
- Pinned actions:
  - `actions/checkout` -> `34e114876b0b11c390a56381ad16ebd13914f8d5`
  - `pnpm/action-setup` -> `b906affcce14559ad1aafd4ab0e942779e9f58b1`
  - `actions/setup-node` -> `49933ea5288caeca8642d1e84afbd3f7d6820020`
  - `aws-actions/configure-aws-credentials` v6.2.3 -> `e6de054238d6b7531b4efff3b6587d9aade6a06c`
- The existing deployment policy remains unchanged: source validation completes before AWS OIDC role assumption; static AWS keys and retained GitHub Actions artifacts remain forbidden.

### Regression/quality gate

`scripts/test-github-oidc-deploy-workflow.sh` now validates both CI and deployment workflows and fails when any external `uses:` reference is not a full commit SHA. It also requires the exact reviewed pins above and preserves the existing checks for main-only deployment, protected environments, OIDC-only credentials, source validation before role assumption, account verification, immutable release/deployment scripts, and zero retained Actions artifacts.

### Security / tenant / execution impact

- This change affects build/deployment supply-chain authority only. It does not alter application tenant identity, Browser/Profile access, BYOK retrieval, workflow execution, retries, verification, scheduling semantics, or human recovery.
- No application dependency, AWS resource, IAM permission, queue, database, browser session, or model call is added.
- Future Action upgrades become explicit repository changes that must pass normal review and exact-head CI.

### Validation status

- The change is being published as one coherent branch commit and must not be called green until GitHub Actions completes successfully on that exact SHA.
- If CI fails, the failure must be root-caused before any corrective commit; checks must not be weakened.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Browser Profile and credential-vault creation can leave bounded orphan resources after ambiguous/abandoned cross-service creation; cleanup must not guess under uncertain persistence.
- Recurring secret typed workflow inputs remain unsupported by design and require vault-backed references if live demand proves them necessary.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, run the protected real AWS vertical demonstration from `main`:

1. deploy immutable artifacts and pass live public/auth smoke;
2. sign in through Cognito/Google and configure an OpenAI BYOK credential;
3. create an automation and exercise replay-safe creation under request uncertainty;
4. capture a real workflow through AgentCore Live View and trusted worker completion;
5. compile, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
6. publish with server-owned tested-workflow selection, recurrence/timezone, and any explicitly non-secret recurring inputs;
7. verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, effect verification, history, CloudWatch, and SES;
8. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path rather than additional recovery micro-hardening.
