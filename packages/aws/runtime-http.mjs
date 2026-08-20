import { createServer } from "node:http";
import {
  createAwsAgentCoreScheduledRuntime,
  createAwsAgentCoreScheduledRuntimeInvocationFromHttp,
} from "./dist/index.js";

const PORT = 8080;
const MAX_BODY_BYTES = 1_048_576;
const MAX_RUNTIME_REQUEST_MILLISECONDS = 3_600_000;
const composition = createAwsAgentCoreScheduledRuntime({ env: process.env });

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

const server = createServer((request, response) => {
  const path = requestPath(request);
  if (request.method === "GET" && path === "/ping") {
    sendJson(
      response,
      composition.kind === "CONFIGURED" ? 200 : 503,
      { status: composition.kind === "CONFIGURED" ? "Healthy" : "Unhealthy" },
    );
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
      const result = await composition.entrypoint.handle(invocation);
      sendJson(response, 200, result);
    } catch {
      // The runtime host is a security boundary: provider/browser exceptions,
      // WorkloadAccessToken values, and BYOK material must never be reflected.
      sendJson(response, 500, { error: "scheduled execution failed" });
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
