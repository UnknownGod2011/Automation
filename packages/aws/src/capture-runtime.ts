import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type {
  CaptureCollectionTaskStarter,
  CaptureCollectionWorker,
  CaptureCollectionWorkerRequest,
  CompleteCaptureResult,
  OwnershipScope,
} from "@automation/core";
import type { AwsScheduledRunInvocation } from "./scheduled-run-handler.js";
import { agentCoreClientToken, scopedResourceIdentity } from "./idempotency.js";

const MAX_ID_LENGTH = 160;
const MAX_RUNTIME_USER_ID_LENGTH = 128;
const MAX_RUNTIME_BODY_BYTES = 16_384;

export interface AwsAgentCoreCaptureCollectionPayload {
  kind: "CAPTURE_COLLECTION";
  automationId: string;
  captureSessionId: string;
}

export interface AgentCoreCaptureCollectionInvokeRequest {
  runtimeArn: string;
  runtimeSessionId: string;
  runtimeUserId: string;
  payload: string;
}

export interface AgentCoreCaptureCollectionInvokeApi {
  invoke(request: AgentCoreCaptureCollectionInvokeRequest): Promise<string>;
}

export interface AwsAgentCoreCaptureCollectionConfiguration {
  region: string;
  tenantId: string;
  runtimeArn: string;
}

function token(value: string, name: string, maxLength = MAX_ID_LENGTH): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${name} is invalid`);
  return normalized;
}

function decodePayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("capture collection payload is not valid JSON");
  }
}

function parsePayload(value: unknown): AwsAgentCoreCaptureCollectionPayload {
  const decoded = decodePayload(value);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("capture collection payload is invalid");
  }
  const record = decoded as Readonly<Record<string, unknown>>;
  if (record.kind !== "CAPTURE_COLLECTION") throw new Error("capture collection payload kind is invalid");
  if (typeof record.automationId !== "string" || typeof record.captureSessionId !== "string") {
    throw new Error("capture collection identity is invalid");
  }
  return {
    kind: "CAPTURE_COLLECTION",
    automationId: token(record.automationId, "automationId"),
    captureSessionId: token(record.captureSessionId, "captureSessionId"),
  };
}

function parseStartAck(payload: string, captureSessionId: string): void {
  if (new TextEncoder().encode(payload).byteLength > MAX_RUNTIME_BODY_BYTES) {
    throw new Error("AgentCore capture collection acknowledgement is too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    throw new Error("AgentCore capture collection acknowledgement is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AgentCore capture collection acknowledgement is invalid");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.kind !== "CAPTURE_COLLECTION_STARTED" || record.captureSessionId !== captureSessionId) {
    throw new Error("AgentCore capture collection acknowledgement identity mismatch");
  }
}

export class AwsSdkAgentCoreCaptureCollectionInvokeApi implements AgentCoreCaptureCollectionInvokeApi {
  private readonly client: BedrockAgentCoreClient;

  constructor(region: string) {
    if (!region.trim()) throw new Error("AWS region is required for capture collection invocation");
    this.client = new BedrockAgentCoreClient({ region });
  }

  async invoke(request: AgentCoreCaptureCollectionInvokeRequest): Promise<string> {
    const output = await this.client.send(new InvokeAgentRuntimeCommand({
      agentRuntimeArn: request.runtimeArn,
      runtimeSessionId: request.runtimeSessionId,
      runtimeUserId: request.runtimeUserId,
      contentType: "application/json",
      accept: "application/json",
      payload: new TextEncoder().encode(request.payload),
    }));
    if (!output.response) throw new Error("AgentCore Runtime returned no capture collection acknowledgement");
    return output.response.transformToString();
  }
}

export class AwsAgentCoreCaptureCollectionTaskStarter implements CaptureCollectionTaskStarter {
  private readonly api: AgentCoreCaptureCollectionInvokeApi;

  constructor(
    private readonly configuration: AwsAgentCoreCaptureCollectionConfiguration,
    api?: AgentCoreCaptureCollectionInvokeApi,
  ) {
    this.api = api ?? new AwsSdkAgentCoreCaptureCollectionInvokeApi(configuration.region);
  }

  async start(request: CaptureCollectionWorkerRequest): Promise<void> {
    if (request.scope.tenantId !== this.configuration.tenantId) {
      throw new Error("capture collection ownership does not match the configured tenant");
    }
    const automationId = token(request.automationId, "automationId");
    const captureSessionId = token(request.captureSessionId, "captureSessionId");
    const runtimeUserId = token(request.scope.userId, "userId", MAX_RUNTIME_USER_ID_LENGTH);
    const payload: AwsAgentCoreCaptureCollectionPayload = {
      kind: "CAPTURE_COLLECTION",
      automationId,
      captureSessionId,
    };
    const serialized = JSON.stringify(payload);
    const identity = scopedResourceIdentity(
      request.scope,
      "capture-collection",
      automationId,
      captureSessionId,
    );
    const response = await this.api.invoke({
      runtimeArn: this.configuration.runtimeArn,
      runtimeSessionId: agentCoreClientToken("capture", identity),
      runtimeUserId,
      payload: serialized,
    });
    parseStartAck(response, captureSessionId);
  }
}

export class AwsCaptureCollectionRuntimeHandler {
  constructor(private readonly worker: Pick<CaptureCollectionWorker, "execute">) {}

  async handle(invocation: AwsScheduledRunInvocation): Promise<CompleteCaptureResult> {
    const payload = parsePayload(invocation.payload);
    const request: CaptureCollectionWorkerRequest = {
      scope: { ...invocation.trustedScope },
      automationId: payload.automationId,
      captureSessionId: payload.captureSessionId,
    };
    return this.worker.execute(request);
  }
}

export function isAwsAgentCoreCaptureCollectionPayload(payload: unknown): boolean {
  const decoded = decodePayload(payload);
  return Boolean(
    decoded &&
    typeof decoded === "object" &&
    !Array.isArray(decoded) &&
    (decoded as Readonly<Record<string, unknown>>).kind === "CAPTURE_COLLECTION",
  );
}

export function captureCollectionTaskKey(input: {
  scope: OwnershipScope;
  automationId: string;
  captureSessionId: string;
}): string {
  return scopedResourceIdentity(
    input.scope,
    "capture-collection-task",
    token(input.automationId, "automationId"),
    token(input.captureSessionId, "captureSessionId"),
  );
}
