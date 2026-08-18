# End Goal

## Product promise

A user signs in, creates an automation for a web application, demonstrates how to navigate it in a secure cloud browser, supplies the objective the automation must accomplish, verifies a test run, schedules recurrence, and can then close their device. At the scheduled time the cloud execution plane restores the web session, executes the workflow, reasons through dynamic decisions, verifies effects, records evidence, and either completes or pauses safely for human intervention.

## User journey

1. Sign in with Google or email.
2. Dashboard shows automations, status, next run, last run, and attention states.
3. Create Automation:
   - target website URL
   - task prompt/objective
   - consent/authorization acknowledgement
   - optional completion email
4. Capture Workflow:
   - open isolated cloud browser
   - user signs in to target site themselves
   - capture browser events, semantic element metadata, page state, screenshots, and optional recording/video
   - persist authenticated browser profile separately from application metadata
5. Compile the demonstration into a versioned semantic workflow graph.
6. Run a fresh test execution. User may take control and teach corrections.
7. User approves the workflow and chooses hourly/daily/weekly/custom recurrence and timezone.
8. Publish to cloud.
9. Scheduled runs execute without the user's device being online.
10. Dashboard exposes run timeline, reasoning summaries, evidence, failures, edit/pause/disable controls.
11. If execution is genuinely blocked, checkpoint and pause; notify the owner; allow manual repair and resume.

## Non-negotiable engineering properties

- Cloud-first: no scheduled execution depends on the user's laptop or browser remaining online.
- Durable orchestration: reasoning/browser processes are ephemeral; workflow/run state is persisted externally.
- Deterministic-first browser execution with semantic/model fallback only when necessary.
- Every consequential action has an explicit expected effect and verification step.
- Bounded retries with failure classification; never infinite loops.
- Human takeover is a first-class state, not an exception path.
- Multi-tenant ownership boundaries exist from the first schema even while the MVP has one user.
- Provider-pluggable reasoning layer. Initial mode is BYOK; future managed credits do not require redesigning workflows.
- Raw API keys are never stored in normal application tables or logs.
- Browser authentication state is isolated from workflow metadata and protected as sensitive data.
- Version every published workflow. Existing runs execute against an immutable version.
- Idempotent run creation and duplicate-run protection.
- Observable: structured events, trace IDs, run/step history, useful failure evidence.
- Infrastructure is defined as code and environments are reproducible.
- Third-party terms, permissions, MFA, CAPTCHA, and anti-bot controls are respected; the platform pauses rather than bypassing them.

## Initial target architecture

Control plane:
- Next.js + TypeScript
- Cognito authentication
- API Gateway/Lambda APIs
- DynamoDB metadata/state
- S3 large artifacts
- AgentCore Identity credential references

Execution plane:
- EventBridge Scheduler
- SQS dispatch buffer
- Step Functions Standard orchestration
- AgentCore Runtime + Strands reasoning
- AgentCore Browser + Browser Profiles + Live View
- Playwright/CDP deterministic executor
- semantic/model fallback for dynamic decisions and UI drift
- SES notifications
- CloudWatch/AgentCore observability

## MVP definition of done

A real user can teach one permitted arbitrary web workflow in a cloud browser, compile and inspect it, test it, approve it, schedule it, turn off their computer, and later see a cloud run complete with persisted login state and a detailed run record. At least one controlled failure must demonstrate bounded retry, checkpoint, notification, human takeover, correction, and successful resume.

## Out of scope until the core loop is reliable

- Marketplace/community workflow sharing
- Billing/subscriptions
- Mobile apps
- Large catalog of site-specific compatibility packs
- Unbounded autonomous purchasing or destructive actions
- CAPTCHA/security-control bypass
- Fine-tuning custom models
