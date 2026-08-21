import type {
  BrowserExecutionRuntimeFactory,
  ReasoningCredentialPoolPolicy,
} from "@automation/core";
import {
  CaptureCollectionService,
  CaptureCollectionWorker,
  CaptureCompletionService,
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
import { AgentCorePlaywrightCaptureEventSource } from "./capture-collector.js";
import { AwsDynamoCaptureCollectionControlStore } from "./capture-control.js";
import { AwsCaptureCollectionRuntimeHandler } from "./capture-runtime.js";
import { AgentCoreCaptureSessionFinalizer } from "./capture-session.js";
import { AwsDynamoCaptureSessionStore } from "./capture-session-store.js";
import { AwsCaptureTraceRepository } from "./capture-trace-store.js";
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
import { AwsFreshTestRunHandler } from "./fresh-test-runtime.js";
import { AwsDynamoHumanResolutionClaimStore } from "./human-resolution.js";
import { AwsDynamoHumanResumeAuditStore } from "./human-resume-audit.js";
import { AwsDynamoHumanResumeEffectReconciliationStore } from "./human-resume-effect.js";
import { AwsDynamoHumanResumeExecutionLeaseStore } from "./human-resume-lease.js";
import { AwsHumanResumeRunHandler } from "./human-resume-runtime.js";
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
  freshTestRunner?: AwsScheduledRunExecutionRunner;
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
      freshTestHandler: AwsFreshTestRunHandler;
      humanResumeHandler: AwsHumanResumeRunHandler;
      captureCollectionHandler: AwsCaptureCollectionRuntimeHandler;
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
  const documentClient = overrides?.dynamo ?? createAwsDynamoDocumentClient({ region });

  const automationRepository = new AwsDynamoAutomationRepository(documentClient, dynamo.config);
  const runRepository = new AwsDynamoRunRepository(documentClient, dynamo.config);
  const checkpointRepository = new AwsDynamoCheckpointRepository(documentClient, dynamo.config);
  const lockManager = new AwsDynamoAutomationLockManager(documentClient, dynamo.config);
  const credentialMetadata = new AwsDynamoCredentialMetadataRepository(documentClient, dynamo.config);

  const artifactApi = overrides?.artifacts ?? new AwsSdkS3ArtifactApi(artifacts.config, { region });
  const artifactStore = new AwsS3ArtifactStore(artifactApi, artifacts.config.prefix);
  const workflowDocuments = overrides?.workflowDocuments ??
    new AwsSdkS3WorkflowDocumentApi(artifacts.config, { region });
  const workflowRepository = new AwsWorkflowVersionRepository(
    documentClient,
    dynamo.config,
    workflowDocuments,
    artifacts.config,
  );

  const browserProfileApi = overrides?.browserProfiles ?? new AwsSdkAgentCoreBrowserProfileApi({ region });
  const browserProfiles = new AgentCoreBrowserProfileStore(browserProfileApi);
  const browserData = overrides?.browserData ?? new AwsSdkAgentCoreBrowserDataApi({ region });
  const browserSigner = overrides?.browserSigner ?? new AwsAgentCoreBrowserConnectionSigner(region);
  const sessions = new AgentCoreBrowserSessionManager(
    browserData,
    browserSigner,
    adapter.config.browserIdentifier,
  );
  const runtimeFactory = overrides?.runtimeFactory ?? new AgentCorePlaywrightRuntimeFactory(artifactStore);

  const credentialControl = overrides?.credentialControl ?? new AwsSdkAgentCoreApiKeyControlApi({ region });
  const credentialData = overrides?.credentialData ?? new AwsSdkAgentCoreApiKeyDataApi({ region });
  const credentialVault = new AgentCoreIdentityCredentialVault(credentialControl, credentialData);
  const credentialPolicy = options.credentialPolicy ?? DEFAULT_CREDENTIAL_POLICY;

  const reporting = createAwsScheduledRunReporting({
    env: options.env,
    ...(options.reporting ?? {}),
  });
  const coordinator = {
    automations: automationRepository,
    workflows: workflowRepository,
    runs: runRepository,
    checkpoints: checkpointRepository,
    profiles: browserProfiles,
    locks: lockManager,
  };
  const worker = {
    sessions,
    runtimeFactory,
    runs: runRepository,
    checkpoints: checkpointRepository,
    browserSessionTimeoutSeconds: adapter.config.browserSessionTimeoutSeconds,
  };
  const credentials = {
    metadata: credentialMetadata,
    vault: credentialVault,
    policy: credentialPolicy,
  };

  const handler = new AwsScheduledRunHandler(handlerConfiguration, {
    coordinator,
    worker,
    credentials,
    reporter: reporting.reporter,
    ...(overrides?.runner ? { runner: overrides.runner } : {}),
    ...(overrides?.openAiFetch ? { openAiFetch: overrides.openAiFetch } : {}),
  });
  const freshTestHandler = new AwsFreshTestRunHandler(handlerConfiguration.openAiModel, {
    coordinator,
    worker,
    credentials,
    ...(overrides?.freshTestRunner ? { runner: overrides.freshTestRunner } : {}),
    ...(overrides?.openAiFetch ? { openAiFetch: overrides.openAiFetch } : {}),
  });
  const humanResumeHandler = new AwsHumanResumeRunHandler({
    automations: automationRepository,
    workflows: workflowRepository,
    runs: runRepository,
    checkpoints: checkpointRepository,
    sessions,
    runtimeFactory,
    claims: new AwsDynamoHumanResolutionClaimStore(documentClient, dynamo.config),
    leases: new AwsDynamoHumanResumeExecutionLeaseStore(documentClient, dynamo.config),
    effects: new AwsDynamoHumanResumeEffectReconciliationStore(documentClient, dynamo.config),
    audit: new AwsDynamoHumanResumeAuditStore(documentClient, dynamo.config),
    credentialMetadata,
    credentialVault,
    credentialPolicy,
    openAiModel: handlerConfiguration.openAiModel,
    browserSessionTimeoutSeconds: adapter.config.browserSessionTimeoutSeconds,
    reporter: reporting.reporter,
    ...(overrides?.openAiFetch ? { openAiFetch: overrides.openAiFetch } : {}),
  });

  const captureSessions = new AwsDynamoCaptureSessionStore(
    documentClient,
    dynamo.config.tableName,
  );
  const captureControls = new AwsDynamoCaptureCollectionControlStore(
    documentClient,
    dynamo.config.tableName,
  );
  const captureTraces = new AwsCaptureTraceRepository(
    documentClient,
    dynamo.config,
    workflowDocuments,
    artifacts.config,
  );
  const captureCollector = new CaptureCollectionService(
    new AgentCorePlaywrightCaptureEventSource(
      browserSigner,
      adapter.config.browserIdentifier,
    ),
  );
  const captureCompletion = new CaptureCompletionService(
    captureSessions,
    new AgentCoreCaptureSessionFinalizer(browserData, adapter.config.browserIdentifier),
    {
      async persistCapture(request) {
        await captureTraces.putImmutable(request.trace);
        return request.trace;
      },
    },
    captureTraces,
  );
  const captureCollectionHandler = new AwsCaptureCollectionRuntimeHandler(
    new CaptureCollectionWorker({
      automations: automationRepository,
      sessions: captureSessions,
      controls: captureControls,
      collector: captureCollector,
      completion: captureCompletion,
    }),
  );

  return {
    kind: "CONFIGURED",
    handler,
    freshTestHandler,
    humanResumeHandler,
    captureCollectionHandler,
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
