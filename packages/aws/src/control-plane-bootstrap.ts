import type {
  BrowserExecutor,
  ReasoningProvider,
  VerificationEngine,
} from "@automation/core";
import {
  AutomationControlPlaneHttpHandler,
  AutomationControlPlaneService,
  AutomationProductLifecycleService,
  AutomationScheduleLifecycleService,
  CaptureAwareControlPlaneHttpHandler,
  CaptureCollectionControlService,
  CaptureCompletionService,
  CaptureRecordingControlPlaneService,
  ProviderCredentialManagementService,
  TrustedCaptureCompletionHandler,
  type ControlPlaneCapabilities,
} from "@automation/core";
import {
  AgentCoreBrowserProfileStore,
  AwsSdkAgentCoreBrowserProfileApi,
  type AgentCoreBrowserProfileApi,
} from "./browser-profile.js";
import {
  AwsSdkAgentCoreBrowserDataApi,
  type AgentCoreBrowserDataApi,
} from "./browser-session.js";
import { AwsDynamoCaptureCollectionControlStore } from "./capture-control.js";
import {
  AgentCoreCaptureSessionFinalizer,
  AgentCoreCaptureSessionStarter,
  AwsAgentCoreBrowserLiveViewSigner,
  type AgentCoreBrowserLiveViewSigner,
} from "./capture-session.js";
import {
  AwsDynamoCaptureSessionStore,
  type CaptureDynamoClientLike,
} from "./capture-session-store.js";
import { AwsCaptureTraceRepository } from "./capture-trace-store.js";
import { loadAwsCognitoControlPlaneAuthConfig } from "./cognito-auth.js";
import {
  createAwsControlPlaneLambdaHandler,
  type AwsControlPlaneLambdaResult,
} from "./control-plane-lambda.js";
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
  AwsAgentCoreFreshTestExecutionPort,
  readAwsAgentCoreFreshTestConfiguration,
  type AgentCoreFreshTestInvokeApi,
} from "./fresh-test-runtime.js";
import {
  AgentCoreIdentityCredentialVault,
  AwsSdkAgentCoreApiKeyControlApi,
  AwsSdkAgentCoreApiKeyDataApi,
  type AgentCoreApiKeyControlApi,
  type AgentCoreApiKeyDataApi,
} from "./identity-vault.js";
import { loadAwsAdapterConfig } from "./config.js";
import {
  loadAwsArtifactStoreConfig,
} from "./artifact-store.js";
import {
  createAwsSchedulingComposition,
  type AwsSchedulingComposition,
} from "./scheduling-composition.js";
import {
  AwsSdkS3WorkflowDocumentApi,
  AwsWorkflowVersionRepository,
  type S3WorkflowDocumentApi,
} from "./workflow-version.js";

function controlPlaneExecutionError(operation: string): Error {
  return new Error(`${operation} is unavailable in the control-plane process`);
}

const CONTROL_PLANE_BROWSER: BrowserExecutor = {
  async executeDeterministic() {
    throw controlPlaneExecutionError("browser execution");
  },
  async executeSemantic() {
    throw controlPlaneExecutionError("semantic browser execution");
  },
};

const CONTROL_PLANE_VERIFIER: VerificationEngine = {
  async verify() {
    throw controlPlaneExecutionError("browser verification");
  },
};

const CONTROL_PLANE_REASONER: ReasoningProvider = {
  async decide() {
    throw controlPlaneExecutionError("model reasoning");
  },
};

export interface AwsControlPlaneBootstrapOverrides {
  dynamo?: DynamoDocumentClientLike;
  captureDynamo?: CaptureDynamoClientLike;
  workflowDocuments?: S3WorkflowDocumentApi;
  browserProfiles?: AgentCoreBrowserProfileApi;
  browserData?: AgentCoreBrowserDataApi;
  liveViewSigner?: AgentCoreBrowserLiveViewSigner;
  credentialControl?: AgentCoreApiKeyControlApi;
  credentialData?: AgentCoreApiKeyDataApi;
  freshTestInvoke?: AgentCoreFreshTestInvokeApi;
  scheduling?: AwsSchedulingComposition;
}

export interface AwsControlPlaneBootstrapOptions {
  env: Readonly<Record<string, string | undefined>>;
  overrides?: AwsControlPlaneBootstrapOverrides;
}

export type AwsControlPlaneBootstrapResult =
  | { kind: "NOT_CONFIGURED"; missing: readonly string[] }
  | {
      kind: "CONFIGURED";
      service: AutomationControlPlaneService;
      http: CaptureAwareControlPlaneHttpHandler;
      lambda: Extract<AwsControlPlaneLambdaResult, { kind: "CONFIGURED" }>;
      captureCompletion: TrustedCaptureCompletionHandler;
      capabilities: ControlPlaneCapabilities;
      configuration: {
        region: string;
        tableName: string;
        artifactBucket: string;
        browserIdentifier: string;
        runtimeArn: string;
        schedulerGroupName: string;
      };
    };

function uniqueMissing(groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())];
}

function notificationsCapability(env: Readonly<Record<string, string | undefined>>): ControlPlaneCapabilities["notifications"] {
  return env.AUTOMATION_SES_FROM_EMAIL?.trim() && env.AUTOMATION_COGNITO_USER_POOL_ID?.trim()
    ? "CONFIGURED"
    : "NOT_CONFIGURED";
}

export function createAwsControlPlaneBootstrap(
  options: AwsControlPlaneBootstrapOptions,
): AwsControlPlaneBootstrapResult {
  const adapter = loadAwsAdapterConfig(options.env);
  const dynamo = loadAwsDynamoDbConfig(options.env);
  const artifacts = loadAwsArtifactStoreConfig(options.env);
  const auth = loadAwsCognitoControlPlaneAuthConfig(options.env);
  const freshTest = readAwsAgentCoreFreshTestConfiguration(options.env);
  const schedulingResult = options.overrides?.scheduling
    ? { configured: true as const, composition: options.overrides.scheduling }
    : createAwsSchedulingComposition(options.env);

  const missing = uniqueMissing([
    adapter.configured ? [] : adapter.missing,
    dynamo.configured ? [] : dynamo.missing,
    artifacts.configured ? [] : artifacts.missing,
    auth.configured ? [] : auth.missing,
    freshTest.kind === "CONFIGURED" ? [] : freshTest.missing,
    schedulingResult.configured ? [] : schedulingResult.missing,
  ]);
  if (
    missing.length > 0 ||
    !adapter.configured ||
    !dynamo.configured ||
    !artifacts.configured ||
    !auth.configured ||
    freshTest.kind !== "CONFIGURED" ||
    !schedulingResult.configured
  ) {
    return { kind: "NOT_CONFIGURED", missing };
  }

  const region = adapter.config.region;
  const documentClient = options.overrides?.dynamo ?? createAwsDynamoDocumentClient({ region });
  const captureDynamo = options.overrides?.captureDynamo ?? documentClient;
  const workflowDocuments = options.overrides?.workflowDocuments ??
    new AwsSdkS3WorkflowDocumentApi(artifacts.config, { region });

  const automations = new AwsDynamoAutomationRepository(documentClient, dynamo.config);
  const runs = new AwsDynamoRunRepository(documentClient, dynamo.config);
  const checkpoints = new AwsDynamoCheckpointRepository(documentClient, dynamo.config);
  const locks = new AwsDynamoAutomationLockManager(documentClient, dynamo.config);
  const workflows = new AwsWorkflowVersionRepository(
    documentClient,
    dynamo.config,
    workflowDocuments,
    artifacts.config,
  );
  const captures = new AwsCaptureTraceRepository(
    documentClient,
    dynamo.config,
    workflowDocuments,
    artifacts.config,
  );
  const captureState = new AwsDynamoCaptureSessionStore(
    captureDynamo,
    dynamo.config.tableName,
  );
  const captureControlStore = new AwsDynamoCaptureCollectionControlStore(
    captureDynamo,
    dynamo.config.tableName,
  );
  const captureControl = new CaptureCollectionControlService(captureState, captureControlStore);

  const browserProfileApi = options.overrides?.browserProfiles ??
    new AwsSdkAgentCoreBrowserProfileApi({ region });
  const profiles = new AgentCoreBrowserProfileStore(browserProfileApi);
  const browserData = options.overrides?.browserData ?? new AwsSdkAgentCoreBrowserDataApi({ region });
  const liveViewSigner = options.overrides?.liveViewSigner ?? new AwsAgentCoreBrowserLiveViewSigner(region);
  const captureSessions = new AgentCoreCaptureSessionStarter(
    browserData,
    liveViewSigner,
    adapter.config.browserIdentifier,
    { sessionStore: captureState, controlStore: captureControlStore },
  );

  const credentialControl = options.overrides?.credentialControl ?? new AwsSdkAgentCoreApiKeyControlApi({ region });
  const credentialData = options.overrides?.credentialData ?? new AwsSdkAgentCoreApiKeyDataApi({ region });
  const credentialVault = new AgentCoreIdentityCredentialVault(credentialControl, credentialData);
  const credentialMetadata = new AwsDynamoCredentialMetadataRepository(documentClient, dynamo.config);
  const credentials = new ProviderCredentialManagementService(credentialVault, credentialMetadata);

  const lifecycle = new AutomationProductLifecycleService({
    automations,
    captures,
    workflows,
    runs,
    checkpoints,
    profiles,
    scheduler: schedulingResult.composition.scheduler,
    locks,
    browser: CONTROL_PLANE_BROWSER,
    verifier: CONTROL_PLANE_VERIFIER,
    reasoner: CONTROL_PLANE_REASONER,
  });
  const scheduleLifecycle = new AutomationScheduleLifecycleService({
    automations,
    scheduler: schedulingResult.composition.scheduler,
  });
  const freshTests = new AwsAgentCoreFreshTestExecutionPort(
    freshTest,
    options.overrides?.freshTestInvoke,
  );
  const capabilities: ControlPlaneCapabilities = {
    auth: "CONFIGURED",
    capture: "CONFIGURED",
    cloudExecution: "CONFIGURED",
    scheduling: "CONFIGURED",
    notifications: notificationsCapability(options.env),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle,
    captureSessions,
    captureState,
    capabilities,
    credentials,
    freshTests,
    scheduleLifecycle,
  });
  const baseHttp = new AutomationControlPlaneHttpHandler(service);
  const captureRecording = new CaptureRecordingControlPlaneService(captureState, captureControl);
  const http = new CaptureAwareControlPlaneHttpHandler(baseHttp, captureRecording);
  const lambda = createAwsControlPlaneLambdaHandler(options.env, http);
  if (lambda.kind !== "CONFIGURED") {
    return { kind: "NOT_CONFIGURED", missing: lambda.missing };
  }

  const finalizer = new AgentCoreCaptureSessionFinalizer(
    browserData,
    adapter.config.browserIdentifier,
  );
  const captureCompletion = new TrustedCaptureCompletionHandler(
    new CaptureCompletionService(captureState, finalizer, lifecycle, captures),
  );

  return {
    kind: "CONFIGURED",
    service,
    http,
    lambda,
    captureCompletion,
    capabilities,
    configuration: {
      region,
      tableName: dynamo.config.tableName,
      artifactBucket: artifacts.config.bucket,
      browserIdentifier: adapter.config.browserIdentifier,
      runtimeArn: freshTest.runtimeArn,
      schedulerGroupName: schedulingResult.composition.config.schedulerGroupName,
    },
  };
}
