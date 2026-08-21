# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening.

## Product target

sign in -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> fresh cloud test -> approve -> recurrence/timezone -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed foundation

- Deterministic pnpm/Node/TypeScript build and frozen dependency graph; AWS SDK peer mismatch resolved.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts plus local/mock end-to-end lifecycle.
- Next.js/Cognito control plane, capture/compile/test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View + long-running capture, AgentCore Identity BYOK, OpenAI reasoning, AgentCore fresh/scheduled execution, Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, and GitHub OIDC.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a real vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `3370156375909bfad69019a85fa3eb35785475a3` (`Add AWS vertical demo web configuration`) is green on CI #197.
- GitHub Actions on the exact new head remains authoritative; no new pass is claimed before it exists.

## 2026-08-21 — AWS-hosted Next.js web deployment

The remaining real-demo blocker was the lack of a reproducible public Next.js origin. The existing app already emitted Next.js standalone output, so this slice adds `package-web-lambda.sh` and deploys that artifact through `infra/aws/web-app.yaml` using AWS Lambda Web Adapter v1.0.1 layer 28 (Apache-2.0).

The release manifest now contains a third immutable, versioned S3 artifact for the web application. Ordered deployment performs a two-phase web rollout: create the web Lambda/Function URL with empty app configuration, derive the exact HTTPS origin, use that origin for Cognito callback/logout configuration, deploy the execution/control plane, then update the same web function with the trusted control-plane URL, Cognito domain/client ID, and canonical origin. This removes the external-hosting prerequisite without a callback-URL dependency cycle.

### Security / tenancy / idempotency / concurrency / retry / cost / observability

- The web Lambda role can write only its own CloudWatch log stream; it has no DynamoDB/S3/AgentCore/Identity/Scheduler/SES execution permissions.
- The Function URL is intentionally public because it serves the sign-in UI. User actions still require Cognito cookies and the backend control-plane API remains JWT protected.
- AWS's post-October-2025 Function URL model requires both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`; the latter is constrained with `InvokedViaFunctionUrl`.
- Reserved concurrency is bounded (default 5) to cap public-endpoint compute exposure. No retry loop or workflow authority is added.
- Web code is version-pinned through the same create-only/versioned S3 release boundary as the runtime/control-plane ZIPs.
- Environment files are explicitly removed from the packaged standalone tree. Deployment configuration contains public coordinates only.
- Packaging adds no npm dependency; Lambda Web Adapter is an official AWS-maintained Apache-2.0 deployment extension pinned to layer version 28.

### Validation added

- CI builds the real Next.js standalone Lambda ZIP and verifies its startup/server contract.
- Release-contract tests now require all three immutable artifacts and exact S3 VersionIds.
- Deployment-contract tests prove web bootstrap precedes Cognito, callback/logout URLs are derived from the deployed web origin, web finalization receives trusted backend outputs, and environment JSON cannot override those derived values.
- Exact-head GitHub Actions after publication is authoritative.

## Next product milestones

1. Run the controlled real AWS vertical demo using the deployment's `outputs.webOrigin`.
2. Fix only concrete defects exposed by that environment; do not return to recovery micro-hardening without a demonstrated need.
3. If repeatable, add minimal live-cloud smoke automation that uses short-lived credentials and retains no secret-bearing Actions artifacts.
4. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations

- Live OpenAI/SES/Cognito/AgentCore behavior still requires real AWS validation; deterministic CI is not live-cloud proof.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract if a workflow needs secrets beyond the persisted Browser Profile.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current ordering fails closed.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
