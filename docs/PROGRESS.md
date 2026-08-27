# Production Progress

Updated: 2026-08-27

## Current validated baseline

Authoritative GitHub state at the start of this slice: `main` is `c31c5293fbb160c1a42c4571e9912338e22b355b` (`Align Publish runtime input guidance`) and push CI #386 completed successfully on that exact SHA. There are no open pull requests. GitHub reports `main.protected=false`; Issue #29 tracks that operational blocker.

The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, dashboard/create/revision, AgentCore Live View capture with durable Browser Profiles/traces, semantic compilation/inspection, guided asynchronous Fresh Test, guided publish/scheduled inputs, EventBridge Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, OpenAI BYOK through AgentCore Identity, deterministic-first browser execution with constrained reasoning fallback, mandatory effect verification, run timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further crash-recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — make the protected promotion boundary operable

### Product/deployment blocker

The production deploy workflow intentionally refuses AWS OIDC credentials unless its source is the current protected `main` head, but the repository is presently unprotected. The GitHub connector available to development has repository content/workflow permissions but no Administration write permission, so it cannot safely change branch protection itself. Leaving the requirement as prose alone makes the first real deployment unnecessarily manual and error-prone.

### Change

- Added `scripts/configure-main-protection.sh`, an explicit admin-operated GitHub CLI command for the repository's minimum production branch-protection policy.
- The command defaults to verification. Mutation requires `--apply`; no GitHub token is accepted as a CLI argument.
- Before applying protection, the command resolves the current `main` SHA and requires its `validate` check to be completed successfully by the GitHub Actions app (`app_id=15368`). A red, missing, stale, or foreign check causes zero protection mutation.
- The baseline requires strict/up-to-date `validate`, PR-based promotion with zero mandatory external approvals, administrator enforcement, stale-review dismissal, conversation resolution, and blocks force pushes/deletion.
- If `main` is already protected, the command never overwrites or relaxes the existing policy. It verifies the minimum baseline and fails closed if the existing policy is weaker/incompatible.
- After applying a new policy, it verifies that `main` is protected, that the head SHA did not move during the operation, and that GitHub reports the expected controls.
- Added `scripts/test-configure-main-protection.sh` with a fake `gh` API and wired it into CI.
- Updated `docs/AWS_OIDC_DEPLOYMENT.md` with the required admin permission and safe application/verification sequence.

The existing deployment workflow remains unchanged and continues to perform its own live `protected=true` + exact-main-head check immediately before OIDC role assumption.

### Security / tenant isolation

This slice changes repository promotion policy only; it has no application tenant authority. The script inherits GitHub CLI authentication and deliberately never accepts, stores, logs, or writes an administration token. GitHub's branch-protection API requires repository Administration write permission; operators should use a short-lived GitHub App user token or fine-grained PAT scoped only to this repository.

No AWS, BYOK, Browser Profile, capture session, workflow/run state, user data, or provider secret crosses this boundary.

### Idempotency / concurrency / retry / timeout

Applying to an unprotected branch is one explicit PUT followed by authoritative reads. Exact reruns against a compliant protected branch are read-only and return success. Existing incomplete protection is never overwritten automatically. The script also verifies the branch head after mutation; if `main` moves during the operation it fails and requires an operator re-check rather than guessing.

GitHub API/auth/network uncertainty fails closed. There is no retry loop that could repeatedly mutate repository policy.

### Side-effect verification / user recovery

Browser side-effect verification and user recovery are unchanged. This slice gates code promotion/deployment, not workflow execution. The existing deployment workflow still validates source and tests before checking branch protection and requesting AWS credentials.

### Cost / observability

The helper makes a bounded handful of GitHub API calls only when an administrator explicitly runs it. CI uses a fake `gh` implementation and makes no GitHub administration call. No AWS resource, Browser/AgentCore allocation, model request, database write, queue delivery, dependency, retained Actions artifact, or recovery infrastructure is added.

### Regression coverage / validation

The no-cloud protection contract proves:

- an unprotected green `main` gets exactly one protection PUT with the expected baseline;
- a compliant existing policy is verified without mutation;
- an incomplete existing policy fails without being overwritten;
- a missing/failed required `validate` check prevents mutation;
- verify-only mode reports unprotected state without mutation;
- malformed repository identity fails before invoking GitHub CLI.

Local shell syntax and the no-cloud contract pass before publication. GitHub Actions on the exact branch head remains authoritative; this document does not claim the new slice is green until that run exists and completes successfully.

## Known production risks / intentionally parked work

- `main` is still unprotected until an administrator actually runs the new helper (or configures an equivalent stronger policy) and GitHub confirms it. The deploy workflow will correctly issue zero AWS credentials until then.
- Production GitHub Environment restrictions/reviewers remain an independent operational control and must be configured separately.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB <-> EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File/password/miscellaneous controls and native multi-select remain intentionally unsupported until they have explicit deterministic execution and verification semantics.

## Next product milestone

1. Obtain an admin-authorized GitHub CLI session for this repository and run `scripts/configure-main-protection.sh --repository UnknownGod2011/Automation --apply`.
2. Re-run with `--verify-only`, confirm GitHub reports `main` protected, then close Issue #29.
3. Configure/verify the protected production GitHub Environment and its OIDC deployment variables/reviewer policy.
4. Run the manual immutable AWS deployment and require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
5. Execute the controlled vertical: Cognito/Google -> OpenAI BYOK -> AgentCore Live View capture -> trusted completion/evidence -> Compile/inspect -> guided >30-second Fresh Test -> guided Publish -> Scheduler/SQS/Step Functions/AgentCore -> SES/CloudWatch -> controlled auth expiry -> secure repair/resume -> terminal success.

Concrete live-environment defects should determine subsequent engineering priorities rather than additional recovery micro-hardening.
