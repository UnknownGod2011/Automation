import { createServer } from "node:http";
import {
  captureCollectionTaskKey,
  createAwsAgentCoreScheduledRuntime,
  createAwsAgentCoreScheduledRuntimeInvocationFromHttp,
  freshTestTaskKey,
  isAwsAgentCoreCaptureCollectionPayload,
  isAwsAgentCoreFreshTestPayload,
} from "./dist/index.js";

const PORT = 8080;
const MAX_BODY_BYTES = 1_048_576;
const MAX_RUNTIME_REQUEST_MILLISECONDS = 3_600_000;
const composition = createAwsAgentCoreScheduledRuntime({ env: process.env });
const backgroundCaptureTasks = new Map();
const backgroundFreshTestTasks = new Map();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function requestPath(request) {
  return (request.url ?? "").split("?", 1)[0];
}

function startCaptureTask(invocation, payload) {
  const key = captureCollectionTaskKey({
    scope: {
      tenantId: process.env.AUTOMATION_TENANT_ID ?? "",
      userId: invocation.runtimeUserId,
    },
    automationId: payload.automationId,
    captureSessionId: payload.captureSessionId,
  });
  if (!backgroundCaptureTasks.has(key)) {
    const task = composition.entrypoint.handle(invocation)
      .catch(() => {
        // Never reflect provider/browser/session errors or secret-bearing payloads.
        console.error(JSON.stringify({ event: "capture_collection_task_failed" }));
      })
      .finally(() => {
        backgroundCaptureTasks.delete(key);
      });
    backgroundCaptureTasks.set(key, task);
  }
}

function startFreshTestTask(invocation, payload) {
  const key = freshTestTaskKey({
    scope: {
      tenantId: process.env.AUTOMATION_TENANT_ID ?? "",
      userId: invocation.runtimeUserId,
    },
    automationId: payload.automationId,
    runId: payload.runId,
  });
  if (!backgroundFreshTestTasks.has(key)) {
    const task = composition.entrypoint.handle(invocation)
      .catch(() => {
        // Durable run/checkpoint state records the execution outcome; never reflect provider details.
        console.error(JSON.stringify({ event: "fresh_test_task_failed" }));
      })
      .finally(() => {
        backgroundFreshTestTasks.delete(key);
      });
    backgroundFreshTestTasks.set(key, task);
  }
}

const server = createServer((request, response) => {
  const path = requestPath(request);
  if (request.method === "GET" && path === "/ping") {
    const configured = composition.kind === "CONFIGURED";
    const status = configured
      ? backgroundCaptureTasks.size + backgroundFreshTestTasks.size > 0 ? "HealthyBusy" : "Healthy"
      : "Unhealthy";
    sendJson(response, configured ? 200 : 503, { status });
    return;
  }

  if (request.method !== "POST" || path !== "/invocations") {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  if (composition.kind !== "CONFIGURED") {
    sendJson(response, 503, { error: "runtime is not configured" });
    return;
  }

  const mediaType = String(request.headers["content-type"] ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    sendJson(response, 415, { error: "application/json is required" });
    return;
  }

  let bytes = 0;
  let body = "";
  let oversized = false;
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    if (oversized) return;
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > MAX_BODY_BYTES) {
      oversized = true;
      body = "";
      return;
    }
    body += chunk;
  });
  request.on("end", async () => {
    if (oversized) {
      sendJson(response, 413, { error: "request body is too large" });
      return;
    }

    try {
      const payload = JSON.parse(body);
      const invocation = createAwsAgentCoreScheduledRuntimeInvocationFromHttp({
        headers: request.headers,
        payload,
      });
      if (isAwsAgentCoreCaptureCollectionPayload(payload)) {
        startCaptureTask(invocation, payload);
        sendJson(response, 200, {
          kind: "CAPTURE_COLLECTION_STARTED",
          captureSessionId: payload.captureSessionId,
        });
        return;
      }
      if (isAwsAgentCoreFreshTestPayload(payload)) {
        startFreshTestTask(invocation, payload);
        sendJson(response, 200, {
          kind: "ACCEPTED",
          runId: payload.runId,
        });
        return;
      }
      const result = await composition.entrypoint.handle(invocation);
      sendJson(response, 200, result);
    } catch {
      // The runtime host is a security boundary: provider/browser exceptions,
      // WorkloadAccessToken values, and BYOK material must never be reflected.
      sendJson(response, 500, { error: "cloud execution failed" });
    }
  });
  request.on("error", () => {
    if (!response.headersSent) {
      sendJson(response, 400, { error: "invalid request" });
    }
  });
});

server.requestTimeout = MAX_RUNTIME_REQUEST_MILLISECONDS;
server.listen(PORT, "0.0.0.0");
