import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type {
  FreshTestExecutionResult,
  FreshTestExecutionPort,
  FreshTestRunRequest,
  FreshTestRunResult,
  OwnershipScope,
  ScheduledRunRequest,
} from "@automation/core";
import {
  OpenAiCredentialBoundReasoningProviderFactory,
} from "./openai-byok-reasoning.js";
import {
  AgentCoreRuntimeHeaderWorkloadAccessTokenSource,
  createAwsByokFreshTestExecution,
  type AwsByokScheduledExecutionDependencies,
} from "./scheduled-execution-composition.js";
import type {
  AwsScheduledRunExecutionRunner,
  AwsScheduledRunHandlerDependencies,
  AwsScheduledRunInvocation,
} from "./scheduled-run-handler.js";
import { agentCoreClientToken, scopedResourceIdentity } from "./idempotency.js";

const RUNTIME_ARN_ENV = "AWS_AGENTCORE_RUNTIME_ARN";
const TENANT_ID_ENV = "AUTOMATION_TENANT_ID";
const REGION_ENV = "AWS_REGION";
const MAX_RUNTIME_BODY_BYTES = 1_048_576;
const MAX_ID_LENGTH = 160;
const MAX_RUNTIME_USER_ID_LENGTH = 128;

export interface AwsAgentCoreFreshTestPayload {
  kind: "FRESH_TEST";
  automationId: string;
  runId: string;
  runtimeVariables?: Readonly<Record<string, unknown>>;
}

export type AwsAgentCoreFreshTestConfiguration =
  | {
      kind: "CONFIGURED";
      region: string;
      tenantId: string;
      runtimeArn: string;
    }
  | { kind: "NOT_CONFIGURED"; missing: readonly string[] };

export function readAwsAgentCoreFreshTestConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): AwsAgentCoreFreshTestConfiguration {
  const region = env[REGION_ENV]?.trim();
  const tenantId = env[TENANT_ID_ENV]?.trim();
  const runtimeArn = env[RUNTIME_ARN_ENV]?.trim();
  const missing = [
    ...(region ? [] : [REGION_ENV]),
    ...(tenantId ? [] : [TENANT_ID_ENV]),
    ...(runtimeArn ? [] : [RUNTIME_ARN_ENV]),
  ];
  if (!region || !tenantId || !runtimeArn) return { kind: "NOT_CONFIGURED", missing };
  if (!runtimeArn.startsWith("arn:")) {
    throw new Error("AWS_AGENTCORE_RUNTIME_ARN must be an ARN");
  }
  return { kind: "CONFIGURED", region, tenantId, runtimeArn };
}

export interface AgentCoreFreshTestInvokeRequest {
  runtimeArn: string;
  runtimeSessionId: string;
  runtimeUserId: string;
  payload: string;
}

export interface AgentCoreFreshTestInvokeApi {
  invoke(request: AgentCoreFreshTestInvokeRequest): Promise<string>;
}

export class AwsSdkAgentCoreFreshTestInvokeApi
  implements AgentCoreFreshTestInvokeApi
{
  private readonly client: BedrockAgentCoreClient;

  constructor(region: string) {
    this.client = new BedrockAgentCoreClient({ region });
  }

  async invoke(request: AgentCoreFreshTestInvokeRequest): Promise<string> {
    const output = await this.client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: request.runtimeArn,
        runtimeSessionId: request.runtimeSessionId,
        runtimeUserId: request.runtimeUserId,
        contentType: "application/json",
        accept: "application/json",
        payload: new TextEncoder().encode(request.payload),
      }),
    );
    if (!output.response) {
      throw new Error("AgentCore Runtime returned no fresh-test response");
    }
    return output.response.transformToString();
  }
}

function token(value: string, name: string, maxLength = MAX_ID_LENGTH): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${name} is invalid`);
  }
  return normalized;
}

function isVariables(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFreshTestPayload(value: unknown): AwsAgentCoreFreshTestPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fresh-test payload is invalid");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.kind !== "FRESH_TEST") throw new Error("fresh-test payload kind is invalid");
  if (typeof record.automationId !== "string" || typeof record.runId !== "string") {
    throw new Error("fresh-test payload identity is invalid");
  }
  if (record.runtimeVariables !== undefined && !isVariables(record.runtimeVariables)) {
    throw new Error("fresh-test runtime variables are invalid");
  }
  return {
    kind: "FRESH_TEST",
    automationId: token(record.automationId, "automationId"),
    runId: token(record.runId, "runId"),
    ...(record.runtimeVariables !== undefined
      ? { runtimeVariables: structuredClone(record.runtimeVariables) }
      : {}),
  };
}

function decodeInvocationPayload(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new Error("fresh-test invocation payload is not valid JSON");
  }
}

function parseFreshTestResult(
  payload: string,
  expectedRunId: string,
): FreshTestExecutionResult {
  if (new TextEncoder().encode(payload).byteLength > MAX_RUNTIME_BODY_BYTES) {
    throw new Error("AgentCore Runtime fresh-test response is too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    throw new Error("AgentCore Runtime fresh-test response is invalid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("AgentCore Runtime fresh-test response is invalid");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.kind === "ACCEPTED") {
    if (record.runId !== expectedRunId) {
      throw new Error("AgentCore Runtime fresh-test acceptance identity is invalid");
    }
    return { kind: "ACCEPTED", runId: expectedRunId };
  }
  if (record.kind === "DUPLICATE" && typeof record.run === "object" && record.run !== null) {
    return value as FreshTestRunResult;
  }
  if (record.kind === "EXECUTED" && typeof record.execution === "object" && record.execution !== null) {
    return value as FreshTestRunResult;
  }
  throw new Error("AgentCore Runtime fresh-test response has an invalid result kind");
}

export function freshTestTaskKey(input: {
  scope: OwnershipScope;
  automationId: string;
  runId: string;
}): string {
  return scopedResourceIdentity(
    input.scope,
    "fresh-test-task",
    token(input.automationId, "automationId"),
    token(input.runId, "runId"),
  );
}

export class AwsAgentCoreFreshTestExecutionPort implements FreshTestExecutionPort {
  private readonly api: AgentCoreFreshTestInvokeApi;

  constructor(
    private readonly configuration: Extract<
      AwsAgentCoreFreshTestConfiguration,
      { kind: "CONFIGURED" }
    >,
    api?: AgentCoreFreshTestInvokeApi,
  ) {
    this.api = api ?? new AwsSdkAgentCoreFreshTestInvokeApi(configuration.region);
  }

  async execute(request: FreshTestRunRequest): Promise<FreshTestExecutionResult> {
    if (request.scope.tenantId !== this.configuration.tenantId) {
      throw new Error("fresh-test ownership does not match the configured tenant");
    }
    const automationId = token(request.automationId, "automationId");
    const runId = token(request.runId, "runId");
    const runtimeUserId = token(
      request.scope.userId,
      "userId",
      MAX_RUNTIME_USER_ID_LENGTH,
    );
    const payload: AwsAgentCoreFreshTestPayload = {
      kind: "FRESH_TEST",
      automationId,
      runId,
      ...(request.runtimeVariables
        ? { runtimeVariables: structuredClone(request.runtimeVariables) }
        : {}),
    };
    const serialized = JSON.stringify(payload);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RUNTIME_BODY_BYTES) {
      throw new Error("fresh-test request is too large");
    }
    const identity = scopedResourceIdentity(
      request.scope,
      "fresh-test",
      automationId,
      runId,
    );
    const response = await this.api.invoke({
      runtimeArn: this.configuration.runtimeArn,
      runtimeSessionId: agentCoreClientToken("fresh", identity),
      runtimeUserId,
      payload: serialized,
    });
    return parseFreshTestResult(response, runId);
  }
}

export type AwsFreshTestRunHandlerDependencies = Pick<
  AwsScheduledRunHandlerDependencies,
  "coordinator" | "worker" | "credentials" | "openAiFetch"
> & {
  runner?: AwsScheduledRunExecutionRunner;
  now?: () => Date;
};

const defaultRunner: AwsScheduledRunExecutionRunner = async (dependencies, request) =>
  createAwsByokFreshTestExecution(dependencies).worker.execute(request);

export class AwsFreshTestRunHandler {
  private readonly runner: AwsScheduledRunExecutionRunner;
  private readonly providers: OpenAiCredentialBoundReasoningProviderFactory;
  private readonly now: () => Date;

  constructor(
    openAiModel: string,
    private readonly dependencies: AwsFreshTestRunHandlerDependencies,
  ) {
    this.runner = dependencies.runner ?? defaultRunner;
    this.providers = dependencies.openAiFetch
      ? new OpenAiCredentialBoundReasoningProviderFactory(
          { model: openAiModel },
          dependencies.openAiFetch,
        )
      : new OpenAiCredentialBoundReasoningProviderFactory({ model: openAiModel });
    this.now = dependencies.now ?? (() => new Date());
  }

  async handle(invocation: AwsScheduledRunInvocation): Promise<FreshTestRunResult> {
    const payload = parseFreshTestPayload(decodeInvocationPayload(invocation.payload));
    const request: ScheduledRunRequest = {
      scope: { ...invocation.trustedScope },
      automationId: payload.automationId,
      runId: payload.runId,
      scheduledAt: this.now().toISOString(),
      ...(payload.runtimeVariables ? { runtimeVariables: payload.runtimeVariables } : {}),
    };
    const result = await this.runner(
      {
        scope: { ...invocation.trustedScope },
        workloadAccessToken: new AgentCoreRuntimeHeaderWorkloadAccessTokenSource(
          invocation.headers,
        ),
        coordinator: this.dependencies.coordinator,
        worker: this.dependencies.worker,
        credentials: {
          ...this.dependencies.credentials,
          providers: this.providers,
          policy: this.dependencies.credentials.policy,
        },
      } satisfies AwsByokScheduledExecutionDependencies,
      request,
    );

    if (result.kind === "NOT_RUN" && result.preparation.kind === "DUPLICATE") {
      return {
        kind: "DUPLICATE",
        run: result.preparation.run,
        checkpoint: await this.dependencies.worker.checkpoints.get(
          invocation.trustedScope,
          result.preparation.run.runId,
        ),
      };
    }

    const execution =
      result.kind === "EXECUTED"
        ? result.execution
        : {
            run: result.preparation.run,
            checkpoint: await this.dependencies.worker.checkpoints.get(
              invocation.trustedScope,
              result.preparation.run.runId,
            ),
          };

    if (execution.run.status === "SUCCEEDED") {
      const automation = await this.dependencies.coordinator.automations.get(
        invocation.trustedScope,
        payload.automationId,
      );
      if (!automation) throw new Error("automation disappeared after fresh test");
      await this.dependencies.coordinator.automations.put({
        ...automation,
        status: "READY_TO_PUBLISH",
        updatedAt: this.now().toISOString(),
      });
    }

    return { kind: "EXECUTED", execution };
  }
}

export function isAwsAgentCoreFreshTestPayload(payload: unknown): boolean {
  const decoded = decodeInvocationPayload(payload);
  return (
    typeof decoded === "object" &&
    decoded !== null &&
    !Array.isArray(decoded) &&
    (decoded as Readonly<Record<string, unknown>>).kind === "FRESH_TEST"
  );
}
