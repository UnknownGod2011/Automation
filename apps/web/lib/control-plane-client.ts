import type {
  AutomationSummaryView,
  CaptureRecordingView,
  CaptureStartResult,
  DashboardView,
  HumanResumeSubmissionResult,
  ProviderCredentialSummary,
  RunDetailView,
  RunSummaryView,
} from "@automation/core";

export interface WebControlPlaneConfig {
  baseUrl?: string;
  bearerToken?: string;
}

export interface WebControlPlaneStatus {
  configured: boolean;
  reason?: "MISSING_BASE_URL" | "MISSING_BEARER_TOKEN" | "INVALID_BASE_URL";
}

export class WebControlPlaneError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "BAD_RESPONSE" | "REQUEST_FAILED") {
    super(code === "NOT_CONFIGURED" ? "Control plane is not configured" : "Control-plane request failed");
  }
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function normalizedConfig(config: WebControlPlaneConfig): { baseUrl: URL; bearerToken: string } | WebControlPlaneStatus {
  const baseUrl = config.baseUrl?.trim();
  const bearerToken = config.bearerToken?.trim();
  if (!baseUrl) return { configured: false, reason: "MISSING_BASE_URL" };
  if (!bearerToken) return { configured: false, reason: "MISSING_BEARER_TOKEN" };
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return { configured: false, reason: "INVALID_BASE_URL" };
    }
    return { baseUrl: parsed, bearerToken };
  } catch {
    return { configured: false, reason: "INVALID_BASE_URL" };
  }
}

export function readWebControlPlaneConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WebControlPlaneConfig {
  const baseUrl = env.AUTOMATION_CONTROL_PLANE_URL;
  return baseUrl === undefined ? {} : { baseUrl };
}

export type AutomationCommand =
  | "compile"
  | "test"
  | "publish"
  | "schedule"
  | "pause"
  | "resume"
  | "disable";

export class WebControlPlaneClient {
  constructor(
    private readonly config: WebControlPlaneConfig = readWebControlPlaneConfig(),
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  status(): WebControlPlaneStatus {
    const normalized = normalizedConfig(this.config);
    return "baseUrl" in normalized ? { configured: true } : normalized;
  }

  async dashboard(): Promise<DashboardView> {
    if (!this.status().configured) {
      return {
        capabilities: {
          auth: "NOT_CONFIGURED",
          capture: "NOT_CONFIGURED",
          cloudExecution: "NOT_CONFIGURED",
          scheduling: "NOT_CONFIGURED",
          notifications: "NOT_CONFIGURED",
        },
        automations: [],
      };
    }
    return this.request<DashboardView>("/v1/automations", { method: "GET" });
  }

  async automation(automationId: string): Promise<AutomationSummaryView> {
    return this.request(`/v1/automations/${encodeURIComponent(automationId)}`, { method: "GET" });
  }

  async runs(automationId: string): Promise<readonly RunSummaryView[]> {
    const result = await this.request<{ runs: readonly RunSummaryView[] }>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs`,
      { method: "GET" },
    );
    return result.runs;
  }

  async run(automationId: string, runId: string): Promise<RunDetailView> {
    return this.request(
      `/v1/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`,
      { method: "GET" },
    );
  }

  async resumeRun(
    automationId: string,
    runId: string,
    expectedNodeId: string,
  ): Promise<HumanResumeSubmissionResult> {
    return this.request(
      `/v1/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/resume`,
      {
        method: "POST",
        body: JSON.stringify({ expectedNodeId }),
      },
    );
  }

  async credentials(): Promise<readonly ProviderCredentialSummary[]> {
    const result = await this.request<{ credentials: readonly ProviderCredentialSummary[] }>(
      "/v1/credentials",
      { method: "GET" },
    );
    return result.credentials;
  }

  async createCredential(body: Readonly<Record<string, unknown>>): Promise<ProviderCredentialSummary> {
    return this.request("/v1/credentials", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async rotateCredential(credentialId: string, apiKey: string): Promise<ProviderCredentialSummary> {
    return this.request(`/v1/credentials/${encodeURIComponent(credentialId)}/rotate`, {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    });
  }

  async removeCredential(credentialId: string): Promise<{ removed: boolean }> {
    return this.request(`/v1/credentials/${encodeURIComponent(credentialId)}/remove`, {
      method: "POST",
      body: "{}",
    });
  }

  async create(body: Readonly<Record<string, unknown>>): Promise<AutomationSummaryView> {
    return this.request("/v1/automations", { method: "POST", body: JSON.stringify(body) });
  }

  async capture(automationId: string): Promise<CaptureStartResult> {
    return this.request(`/v1/automations/${encodeURIComponent(automationId)}/capture`, {
      method: "POST",
      body: "{}",
    });
  }

  async captureRecording(automationId: string): Promise<CaptureRecordingView> {
    return this.request(`/v1/automations/${encodeURIComponent(automationId)}/capture-recording`, {
      method: "GET",
    });
  }

  async startCaptureRecording(automationId: string, captureSessionId: string): Promise<CaptureRecordingView> {
    return this.request(`/v1/automations/${encodeURIComponent(automationId)}/capture-recording/start`, {
      method: "POST",
      body: JSON.stringify({ captureSessionId }),
    });
  }

  async finishCaptureRecording(automationId: string, captureSessionId: string): Promise<CaptureRecordingView> {
    return this.request(`/v1/automations/${encodeURIComponent(automationId)}/capture-recording/finish`, {
      method: "POST",
      body: JSON.stringify({ captureSessionId }),
    });
  }

  async command<T>(automationId: string, command: AutomationCommand, body: unknown): Promise<T> {
    return this.request<T>(`/v1/automations/${encodeURIComponent(automationId)}/${command}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const normalized = normalizedConfig(this.config);
    if (!("baseUrl" in normalized)) throw new WebControlPlaneError("NOT_CONFIGURED");
    const endpoint = new URL(path, normalized.baseUrl);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        ...init,
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${normalized.bearerToken}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
    } catch {
      throw new WebControlPlaneError("REQUEST_FAILED");
    }
    if (!response.ok) throw new WebControlPlaneError("REQUEST_FAILED");
    try {
      return (await response.json()) as T;
    } catch {
      throw new WebControlPlaneError("BAD_RESPONSE");
    }
  }
}