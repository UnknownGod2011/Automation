import type {
  BrowserExecutionRuntimeFactory,
  ReasoningCredentialPoolPolicy,
} from "@automation/core";
import {
  AwsS3ArtifactStore,
  AwsSdkS3ArtifactApi,
  loadAwsArtifactStoreConfig,
  type S3ArtifactApi,
} from "./artifact-store.js";
import {
  AgentCoreBrowserProfileStore,
  AwsSdkAgentCoreBrowserProfileApi,
  type AgentCoreBrowserProfileApi,
} from "./browser-profile.js";
import {
  AgentCoreBrowserSessionManager,
  AwsAgentCoreBrowserConnectionSigner,
  AwsSdkAgentCoreBrowserDataApi,
  type AgentCoreBrowserConnectionSigner,
  type AgentCoreBrowserDataApi,
} from "./browser-session.js";
import { loadAwsAdapterConfig } from "./config.js";
import { AwsDynamoCredentialMetadataRepository } from "./credential-metadata.js";
import {
  AwsDynamoAutomationLockManager,
  AwsDynamoAutomationRepository,
  AwsDynamoCheckpointRepository,
  AwsDynamoRunRepository,
  createAwsDynamoDocumentClient,
  loadAwsDynamoDbConfig,
  type DynamoDocumentClientLike,
} from "./dynamodb-state.js";
import {
  AgentCoreIdentityCredentialVault,
  AwsSdkAgentCoreApiKeyControlApi,
  AwsSdkAgentCoreApiKeyDataApi,
  type AgentCoreApiKeyControlApi,
  type AgentCoreApiKeyDataApi,
} from "./identity-vault.js";
import type { OpenAiFetch } from "./openai-byok-reasoning.js";
import { AgentCorePlaywrightRuntimeFactory } from "./playwright-runtime.js";
import {
  createAwsScheduledRunReporting,
  type AwsScheduledReportingNotificationState,
  type AwsScheduledRunReportingCompositionOptions,
} from "./scheduled-reporting-composition.js";
import {
  AwsScheduledRunHandler,
  readAwsScheduledRunHandlerConfiguration,
  type AwsScheduledRunExecutionRunner,
} from "./scheduled-run-handler.js";
import {
  AwsSdkS3WorkflowDocumentApi,
  AwsWorkflowVersionRepository,
  type S3WorkflowDocumentApi,
} from "./workflow-version.js";

const DEFAULT_CREDENTIAL_POLICY: ReasoningCredentialPoolPolicy = {
  providerOrder: ["openai"],
  allowSameProviderCredentialFailover: false,
};

/**
 * Narrow seams used by deterministic tests or deployment wrappers that already
 * own long-lived SDK clients. Production defaults construct the concrete AWS
 * adapters directly and continue to use the standard AWS credential chain.
 */
export interface AwsScheduledRunBootstrapOverrides {
  dynamo?: DynamoDocumentClientLike;
  artifacts?: S3ArtifactApi;
  workflowDocuments?: S3WorkflowDocumentApi;
  browserProfiles?: AgentCoreBrowserProfileApi;
  browserData?: AgentCoreBrowserDataApi;
  browserSigner?: AgentCoreBrowserConnectionSigner;
  credentialControl?: AgentCoreApiKeyControlApi;
  credentialData?: AgentCoreApiKeyDataApi;
  runtimeFactory?: BrowserExecutionRuntimeFactory;
  runner?: AwsScheduledRunExecutionRunner;
  openAiFetch?: OpenAiFetch;
}

export interface AwsScheduledRunBootstrapOptions {
  env: Readonly<Record<string, string | undefined>>;
  credentialPolicy?: ReasoningCredentialPoolPolicy;
  reporting?: Omit<AwsScheduledRunReportingCompositionOptions, "env">;
  overrides?: AwsScheduledRunBootstrapOverrides;
}

export type AwsScheduledRunBootstrapResult =
  | {
      kind: "NOT_CONFIGURED";
      missing: readonly string[];
    }
  | {
      kind: "CONFIGURED";
      handler: AwsScheduledRunHandler;
      notifications: AwsScheduledReportingNotificationState;
      configuration: {
        region: string;
        tableName: string;
        artifactBucket: string;
        browserIdentifier: string;
        openAiModel: string;
      };
    };

function uniqueMissing(groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())];
}

/**
 * Builds the production scheduled-run dependency graph from deployment output
 * environment variables without performing network I/O during composition.
 *
 * Missing mandatory execution configuration is returned as one fail-closed
 * NOT_CONFIGURED result. Optional SES recipient resolution remains independent
 * so a notification deployment gap cannot disable execution or telemetry.
 */
export function createAwsScheduledRunBootstrap(
  options: AwsScheduledRunBootstrapOptions,
): AwsScheduledRunBootstrapResult {
  const adapter = loadAwsAdapterConfig(options.env);
  const dynamo = loadAwsDynamoDbConfig(options.env);
  const artifacts = loadAwsArtifactStoreConfig(options.env);
  const handlerConfiguration = readAwsScheduledRunHandlerConfiguration(options.env);

  const missing = uniqueMissing([
    adapter.configured ? [] : adapter.missing,
    dynamo.configured ? [] : dynamo.missing,
    artifacts.configured ? [] : artifacts.missing,
    handlerConfiguration.kind === "CONFIGURED" ? [] : handlerConfiguration.missing,
  ]);
  if (
    missing.length > 0 ||
    !adapter.configured ||
    !dynamo.configured ||
    !artifacts.configured ||
    handlerConfiguration.kind !== "CONFIGURED"
  ) {
    return { kind: "NOT_CONFIGURED", missing };
  }

  const overrides = options.overrides;
  const region = adapter.config.region;
  const documentClient =
    overrides?.dynamo ?? createAwsDynamoDocumentClient({ region });

  const automationRepository = new AwsDynamoAutomationRepository(
    documentClient,
    dynamo.config,
  );
  const runRepository = new AwsDynamoRunRepository(documentClient, dynamo.config);
  const checkpointRepository = new AwsDynamoCheckpointRepository(
    documentClient,
    dynamo.config,
  );
  const lockManager = new AwsDynamoAutomationLockManager(
    documentClient,
    dynamo.config,
  );
  const credentialMetadata = new AwsDynamoCredentialMetadataRepository(
    documentClient,
    dynamo.config,
  );

  const artifactApi =
    overrides?.artifacts ?? new AwsSdkS3ArtifactApi(artifacts.config, { region });
  const artifactStore = new AwsS3ArtifactStore(
    artifactApi,
    artifacts.config.prefix,
  );
  const workflowDocuments =
    overrides?.workflowDocuments ??
    new AwsSdkS3WorkflowDocumentApi(artifacts.config, { region });
  const workflowRepository = new AwsWorkflowVersionRepository(
    documentClient,
    dynamo.config,
    workflowDocuments,
    artifacts.config,
  );

  const browserProfileApi =
    overrides?.browserProfiles ?? new AwsSdkAgentCoreBrowserProfileApi({ region });
  const browserProfiles = new AgentCoreBrowserProfileStore(browserProfileApi);
  const browserData =
    overrides?.browserData ?? new AwsSdkAgentCoreBrowserDataApi({ region });
  const browserSigner =
    overrides?.browserSigner ?? new AwsAgentCoreBrowserConnectionSigner(region);
  const sessions = new AgentCoreBrowserSessionManager(
    browserData,
    browserSigner,
    adapter.config.browserIdentifier,
  );
  const runtimeFactory =
    overrides?.runtimeFactory ?? new AgentCorePlaywrightRuntimeFactory(artifactStore);

  const credentialControl =
    overrides?.credentialControl ?? new AwsSdkAgentCoreApiKeyControlApi({ region });
  const credentialData =
    overrides?.credentialData ?? new AwsSdkAgentCoreApiKeyDataApi({ region });
  const credentialVault = new AgentCoreIdentityCredentialVault(
    credentialControl,
    credentialData,
  );

  const reporting = createAwsScheduledRunReporting({
    env: options.env,
    ...(options.reporting ?? {}),
  });

  const handler = new AwsScheduledRunHandler(handlerConfiguration, {
    coordinator: {
      automations: automationRepository,
      workflows: workflowRepository,
      runs: runRepository,
      checkpoints: checkpointRepository,
      profiles: browserProfiles,
      locks: lockManager,
    },
    worker: {
      sessions,
      runtimeFactory,
      runs: runRepository,
      checkpoints: checkpointRepository,
      browserSessionTimeoutSeconds: adapter.config.browserSessionTimeoutSeconds,
    },
    credentials: {
      metadata: credentialMetadata,
      vault: credentialVault,
      policy: options.credentialPolicy ?? DEFAULT_CREDENTIAL_POLICY,
    },
    reporter: reporting.reporter,
    ...(overrides?.runner ? { runner: overrides.runner } : {}),
    ...(overrides?.openAiFetch ? { openAiFetch: overrides.openAiFetch } : {}),
  });

  return {
    kind: "CONFIGURED",
    handler,
    notifications: reporting.notifications,
    configuration: {
      region,
      tableName: dynamo.config.tableName,
      artifactBucket: artifacts.config.bucket,
      browserIdentifier: adapter.config.browserIdentifier,
      openAiModel: handlerConfiguration.openAiModel,
    },
  };
}
