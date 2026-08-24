# GitHub OIDC AWS Deployment

The production workflow `.github/workflows/deploy-aws.yml` is manual-only, runs from `main`, and assumes an environment-owned AWS role through GitHub OIDC. It does not accept long-lived AWS keys and retains no GitHub Actions ZIP artifacts.

## Protected GitHub Environment

Configure `AWS_REGION`, `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`, `AUTOMATION_RELEASE_BUCKET`, optional `AUTOMATION_RELEASE_KMS_KEY_ID`, and `AUTOMATION_AWS_ENVIRONMENT_JSON` as environment variables. Never add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_SESSION_TOKEN` as repository/environment secrets.

The deployment role trust policy must allow `sts:AssumeRoleWithWebIdentity` only from GitHub's OIDC provider, require audience `sts.amazonaws.com`, and match the exact subject used by this repository plus protected GitHub Environment. Do not use a repository-wide subject wildcard for production. Require environment reviewers/restrictions independently of the IAM trust condition.

The environment JSON contains deployment configuration only. Web callback/logout URLs and AgentCore Browser IDs/ARNs are not operator input: deployment provisions the VPC custom Browser and public web Function URL, then derives their exact identities into downstream stacks.

```json
{
  "schemaVersion": 1,
  "region": "us-east-1",
  "stackPrefix": "automation-prod",
  "parameters": {
    "browser": {
      "EnvironmentName": "prod",
      "BrowserName": "AutomationProdBrowser",
      "SecurityGroupIds": "sg-0123456789abcdef0",
      "SubnetIds": "subnet-0123456789abcdef0,subnet-0123456789abcdef1"
    },
    "web": { "ReservedConcurrency": 5, "MemorySize": 1024 },
    "auth": {
      "UserPoolDomainPrefix": "automation-prod-example",
      "GoogleClientId": "1234567890-example.apps.googleusercontent.com",
      "GoogleClientSecretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:automation/google-oauth-example"
    },
    "runtime": {
      "EnvironmentName": "prod",
      "AutomationTenantId": "tenant-prod",
      "StateTableName": "automation-prod-state",
      "ArtifactBucketName": "automation-prod-artifacts",
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

`SecurityGroupIds` and `SubnetIds` are comma-separated lists of one to sixteen existing VPC resource IDs. They remain environment-owned network inputs. The Browser resource itself is created by `infra/aws/agentcore-browser.yaml` with `NetworkMode: VPC`; environment configuration cannot select public mode or supply an independent Browser ID/ARN.

The Browser security groups, subnet route tables, DNS behavior, network ACLs, and any firewall/proxy policy are still deployment responsibilities. VPC mode creates the enforceable network boundary but does not by itself prove that private/link-local/control-plane destinations are unreachable after DNS resolution or redirects.

## Optional Google sign-in

Native Cognito email sign-in is always available. Google federation is optional and is enabled only when both `GoogleClientId` and `GoogleClientSecretArn` are present in `parameters.auth`; supplying only one fails the CloudFormation rule instead of silently creating a partial identity configuration.

Create the Google OAuth web client separately and configure its redirect URI for the Cognito managed-login domain according to Cognito/Google requirements. Store the OAuth client secret as the entire `SecretString` of an AWS Secrets Manager secret. Put only that secret's ARN in `AUTOMATION_AWS_ENVIRONMENT_JSON`; never put the client secret itself in GitHub variables, the deployment JSON, CloudFormation parameters, Lambda environment variables, or repository files.

`control-plane-auth.yaml` resolves the client secret through a versionless Secrets Manager dynamic reference when it creates the conditional `AWS::Cognito::UserPoolIdentityProvider`. The deployment principal therefore needs narrowly scoped `secretsmanager:GetSecretValue` access to that configured secret in addition to the existing CloudFormation permissions. CloudFormation keeps the resolved secret out of stack parameters/logs, while Cognito necessarily receives it as the external IdP credential. Omitting both Google parameters preserves the email-only deployment path.

## Deployment order and web security

The immutable release contains three versioned S3 artifacts: AgentCore Runtime, control-plane/capture/dispatcher Lambda, and the Next.js standalone web Lambda. Deployment proceeds Browser -> Browser live-state verification -> web bootstrap -> Cognito bootstrap -> Runtime -> scheduling -> control plane -> Cognito finalization -> web finalization -> optional observability.

The Browser stack is deliberately first. It creates only the deployment-owned VPC Browser. The deployer then reads the resulting Browser ID/ARN and verifies the actual AgentCore service state is `READY`, still reports `VPC`, and retains non-empty subnet/security-group configuration before any application stack receives Browser authority.

Web bootstrap intentionally has empty application coordinates and therefore renders the existing `NOT_CONFIGURED` state until finalization supplies trusted backend outputs.

The web Function URL is public because it must serve sign-in. Its Lambda role has only CloudWatch log-stream writes; it has no DynamoDB, S3, AgentCore, Identity, Scheduler, Step Functions, SES, or BYOK permission. Application operations still require Cognito HttpOnly session cookies and the backend API remains JWT protected. Reserved concurrency bounds public compute exposure.

The ZIP uses AWS Lambda Web Adapter x86 layer version 28. No adapter package is added to the pnpm dependency graph. The web code object is create-only and version-pinned exactly like the other release artifacts.

The workflow validates source before requesting an OIDC token, verifies the resulting AWS account, and keeps release/deployment manifests runner-local. CloudFormation plus versioned S3 are the durable deployment record; Actions artifact storage remains unused.
