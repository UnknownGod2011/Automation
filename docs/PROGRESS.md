# Automation Platform Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `4a21f2361d5bfeaa26338f9161f08d90bc472187` (`Exercise SELECT in controlled AWS demo`).
- Push GitHub Actions CI #359 completed successfully on that exact SHA before this slice.
- The AWS-first vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — require a protected exact `main` head before AWS credentials

### Product/deployment gap

The protected AWS deployment workflow is intentionally `main`-only and assumes a short-lived AWS deployment role through GitHub OIDC only after source validation. GitHub's public repository metadata currently reports `main` as unprotected and the repository exposes no rulesets. That makes repository promotion policy an operational prerequisite rather than an enforced deployment prerequisite: a manual deployment could otherwise reach OIDC role assumption even if the trusted branch lost its protection.

### Change

- The deployment job now queries GitHub's branch metadata **after deterministic source validation but before AWS OIDC role assumption**.
- Deployment fails closed unless GitHub reports `main` as protected.
- The gate also requires `GITHUB_SHA` to equal the current `main` head. If `main` advances after a workflow is dispatched, the stale source cannot receive AWS deployment credentials.
- The GitHub API call uses only the job's normal read-scoped `github.token`; no AWS credential exists at this point.
- The deployment summary records that the exact protected `main` head was verified before AWS role assumption.
- The no-cloud OIDC workflow contract now requires the protection/head checks and verifies their ordering ahead of `configure-aws-credentials`.

## Security / tenant isolation

- This is a deployment trust-boundary check; it does not change application tenant identity, Cognito claims, DynamoDB partitioning, Browser Profile ownership, BYOK scope, or workload-token handling.
- No AWS credential is available when the protection check runs. A missing/unreadable GitHub branch response, unprotected branch, or stale SHA all fail closed before OIDC.
- The branch API response is used only for `protected` and current-head SHA; it is not persisted into application storage or deployment artifacts.

## Idempotency / concurrency / retry / timeout

- A deployment dispatched from `main` must still be the current `main` head at credential-assumption time. This intentionally rejects stale concurrent releases rather than racing two source revisions into one environment.
- The branch metadata request has a bounded 10-second network timeout and no retry loop. GitHub API uncertainty blocks deployment rather than granting cloud authority.
- Existing environment-level deployment concurrency, immutable S3 object versions, CloudFormation ordering, and exact release SHA identity remain unchanged.

## Side-effect verification / user recovery

- Browser execution, workflow verification, retry policies, scheduling, and human recovery are unchanged.
- Failure of this gate is an operator/deployment condition, not an automation run failure; no AgentCore Browser/Runtime work or product user state is created.

## Cost / observability

- The change adds one small GitHub REST read per manual deployment before AWS credentials. There is no AWS cost.
- Deployment logs contain only the fixed sanitized gate failure messages; no AWS secret, Cognito token, BYOK key, Browser Profile state, or workload token is introduced.
- GitHub Actions artifacts remain disabled; release/deployment manifests remain runner-local and durable release history stays in versioned S3/CloudFormation.

## Regression coverage

- The deployment-workflow contract requires the protected-main verification step, GitHub branch endpoint, `protected` check, exact-head check, and job token scope.
- The contract proves the protection gate occurs before `aws-actions/configure-aws-credentials`.
- Existing checks continue to reject static AWS credentials, mutable GitHub Action references, Actions artifact uploads, non-`main` deployment, and AWS role assumption before source validation.

## Validation

This slice is complete only after GitHub Actions succeeds on the exact published head. Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, all three production package builds, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite. Never weaken these checks to obtain green status.

## Known production risks / parked work

- Repository administrators still need to configure an actual `main` protection rule/ruleset that requires PR review and successful CI and blocks force-push/deletion/bypass. This code gate can verify protection presence and exact-head freshness; it cannot create repository policy with the currently available integration.
- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- Checkbox, radio, file-upload, password, miscellaneous controls, and multi-select remain intentionally unsupported until they receive explicit provider-neutral semantics and verification.
- SELECT semantic recovery remains intentionally disabled because the bound option may be private per-run data; deterministic retry + human escalation is the current safe boundary.
- VPC Browser route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, configure the required GitHub `main` protection, then run the controlled real AWS vertical:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs; the workflow must refuse AWS credentials until the exact protected `main` head is verified;
2. require strengthened live smoke and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. target `${webOrigin}/demo-target`, authenticate in Live View, wait for authoritative collector readiness, change Priority to **High priority**, type a non-secret note, submit once, finish trusted completion, and inspect capture evidence;
5. compile/inspect and require one SELECT + one TYPE + one verified SUBMIT; run a >30-second Fresh Test with the displayed runtime inputs and inspect timeline/reasoning/evidence;
6. publish a near-future recurrence/timezone with the same values configured through the explicitly non-secret scheduled-input boundary and verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime while the user device is offline;
7. let demo auth expire, verify `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that live environment over speculative recovery hardening.
