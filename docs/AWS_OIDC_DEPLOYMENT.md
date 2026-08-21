# GitHub OIDC AWS Deployment

The production workflow `.github/workflows/deploy-aws.yml` is manual-only, runs from `main`, and assumes an environment-owned AWS role through GitHub OIDC. It does not accept long-lived AWS keys and retains no GitHub Actions ZIP artifacts.

## Protected GitHub Environment

Configure `AWS_REGION`, `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`, `AUTOMATION_RELEASE_BUCKET`, optional `AUTOMATION_RELEASE_KMS_KEY_ID`, and `AUTOMATION_AWS_ENVIRONMENT_JSON` as environment variables. Never add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_SESSION_TOKEN` as repository/environment secrets.

The deployment role trust policy must allow `sts:AssumeRoleWithWebIdentity` only from GitHub's OIDC provider, require audience `sts.amazonaws.com`, and match the exact subject used by this repository plus protected GitHub Environment. Do not use a repository-wide subject wildcard for production. Require environment reviewers/restrictions independently of the IAM trust condition.

The environment JSON contains deployment configuration only. Web callback/logout URLs are not operator input: deployment first creates the server-owned public web Function URL, then derives the exact Cognito callback/logout URLs from that output.

```json
{
  "schemaVersion": 1,
  "region": "us-east-1",
  "stackPrefix": "automation-prod",
  "parameters": {
    "web": { "ReservedConcurrency": 5, "MemorySize": 1024 },
    "auth": { "UserPoolDomainPrefix": "automation-prod-example" },
    "runtime": {
      "EnvironmentName": "prod",
      "AutomationTenantId": "tenant-prod",
      "StateTableName": "automation-prod-state",
      "ArtifactBucketName": "automation-prod-artifacts",
      "AgentCoreBrowserResourceArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:browser-custom/example",
      "OpenAiByokModel": "gpt-5"
    },
    "scheduling": { "EnvironmentName": "prod" },
    "controlPlaneService": {
      "EnvironmentName": "prod",
      "StateTableName": "automation-prod-state",
      "ArtifactBucketName": "automation-prod-artifacts",
      "TenantId": "tenant-prod"
    }
  }
}
```

## Deployment order and web security

The immutable release contains three versioned S3 artifacts: AgentCore Runtime, control-plane/capture/dispatcher Lambda, and the Next.js standalone web Lambda. Deployment proceeds web bootstrap -> Cognito bootstrap -> Runtime -> scheduling -> control plane -> Cognito finalization -> web finalization -> optional observability. Web bootstrap intentionally has empty application coordinates and therefore renders the existing `NOT_CONFIGURED` state until finalization supplies trusted backend outputs.

The web Function URL is public because it must serve sign-in. Its Lambda role has only CloudWatch log-stream writes; it has no DynamoDB, S3, AgentCore, Identity, Scheduler, Step Functions, SES, or BYOK permission. Application operations still require Cognito HttpOnly session cookies and the backend API remains JWT protected. Reserved concurrency bounds public compute exposure.

The ZIP uses AWS Lambda Web Adapter x86 layer version 28. No adapter package is added to the pnpm dependency graph. The web code object is create-only and version-pinned exactly like the other release artifacts.

The workflow validates source before requesting an OIDC token, verifies the resulting AWS account, and keeps release/deployment manifests runner-local. CloudFormation plus versioned S3 are the durable deployment record; Actions artifact storage remains unused.
