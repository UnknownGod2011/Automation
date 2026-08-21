# GitHub OIDC AWS Deployment

The production deployment workflow is `.github/workflows/deploy-aws.yml`. It is manual-only, runs only from `main`, uses a protected GitHub Environment, and obtains short-lived AWS credentials through GitHub OIDC. It never accepts or stores long-lived AWS access keys and it does not upload ZIPs or manifests to GitHub Actions artifact storage.

## GitHub Environment

Create a GitHub Environment such as `staging` or `production`. For production, require reviewers and restrict deployments to `main`. Configure these **environment variables** (not workflow inputs):

- `AWS_REGION` — deployment region, for example `us-east-1`.
- `AWS_ACCOUNT_ID` — exact 12-digit account ID. The OIDC action also uses it as an allowed-account guard.
- `AWS_DEPLOY_ROLE_ARN` — IAM role assumed through `sts:AssumeRoleWithWebIdentity`.
- `AUTOMATION_RELEASE_BUCKET` — S3 bucket with Versioning enabled for immutable release ZIPs.
- `AUTOMATION_AWS_ENVIRONMENT_JSON` — schema-v1 environment document consumed by `scripts/deploy-aws-release.sh`.
- `AUTOMATION_RELEASE_KMS_KEY_ID` — optional KMS key ID/ARN for release-object encryption. If omitted, the release script uses S3 AES-256 encryption.

Do not add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_SESSION_TOKEN` as repository/environment secrets. The workflow intentionally has no static-credential path.

## OIDC trust boundary

The deploy role trust policy should allow `sts:AssumeRoleWithWebIdentity` only from GitHub's OIDC provider, require audience `sts.amazonaws.com`, and match the exact subject claim used by this repository + protected GitHub Environment. Do not use a repository-wide `sub` wildcard for a production role. GitHub Environment protection and the IAM trust condition are both part of the authorization boundary.

A representative trust statement is:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "<EXACT_GITHUB_OIDC_SUB_FOR_THIS_ENVIRONMENT>"
    }
  }
}
```

Use the exact `sub` format configured for the GitHub organization/repository. GitHub claim formats can differ when organization/repository ID claims or GitHub Environments are enabled, so copy the exact intended subject rather than loosening the condition.

## Environment JSON

The deployment JSON contains deployment configuration, not AWS credentials or user BYOK secrets. Derived cross-stack values and immutable S3 object VersionIds are intentionally absent; `scripts/deploy-aws-release.sh` supplies them from prior stack outputs and the reviewed release manifest.

Example shape:

```json
{
  "schemaVersion": 1,
  "region": "us-east-1",
  "stackPrefix": "automation-prod",
  "parameters": {
    "auth": {
      "WebCallbackUrl": "https://app.example.com/api/auth/callback",
      "WebLogoutUrl": "https://app.example.com/",
      "UserPoolDomainPrefix": "automation-prod-example"
    },
    "runtime": {
      "EnvironmentName": "prod",
      "AutomationTenantId": "tenant-prod",
      "StateTableName": "automation-prod-state",
      "ArtifactBucketName": "automation-prod-artifacts",
      "ArtifactPrefix": "automation",
      "AgentCoreBrowserResourceArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:browser-custom/example",
      "OpenAiByokModel": "gpt-5"
    },
    "scheduling": {
      "EnvironmentName": "prod",
      "DispatcherReservedConcurrency": 10,
      "ScheduledRunTimeoutSeconds": 1800
    },
    "controlPlaneService": {
      "EnvironmentName": "prod",
      "StateTableName": "automation-prod-state",
      "ArtifactBucketName": "automation-prod-artifacts",
      "ArtifactPrefix": "automation",
      "TenantId": "tenant-prod",
      "AgentCoreBrowserIdentifier": "aws.browser.v1",
      "ReservedConcurrency": 20,
      "CaptureCompletionReservedConcurrency": 5
    }
  }
}
```

Use environment-specific resource names and the actual AgentCore Browser ARN/identifier expected by the templates. `TenantId`/`AutomationTenantId` are deployment-owned scope values; they are not accepted from user requests.

## Deployment behavior

The workflow validates the deterministic pnpm graph, installs with `--frozen-lockfile`, runs `pnpm check` and `pnpm test`, and only then requests the OIDC token. After AWS identity is verified against `AWS_ACCOUNT_ID`, it packages and uploads immutable versioned artifacts and deploys stacks through the existing ordered deployment script.

The release ID binds the exact Git commit plus the workflow run/attempt. Release and deployment manifests live only in `$RUNNER_TEMP`; they are consumed in the same job and are not retained as GitHub Actions artifacts. CloudFormation/S3 remain the durable deployment record.

A failed or canceled deployment does not automatically roll back already-created immutable S3 object versions. Those objects have no deployment authority unless their manifest reaches the deploy step; periodic S3 lifecycle cleanup can remove old orphaned release versions according to environment retention policy.
