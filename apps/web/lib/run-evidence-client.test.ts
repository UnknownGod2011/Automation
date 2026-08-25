import { describe, expect, it, vi } from "vitest";
import { WebControlPlaneClient, WebControlPlaneError, type FetchLike } from "./control-plane-client";

const config = {
  baseUrl: "https://control.example.com",
  bearerToken: "server-session-token",
};

describe("WebControlPlaneClient run evidence", () => {
  it("requests evidence by bounded ordinal without sending an artifact reference", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => new Response(JSON.stringify({
      kind: "BROWSER_STATE",
      ordinal: 2,
      sizeBytes: 120,
      sequence: 4,
      eventKind: "deterministic-after",
      nodeKind: "CLICK",
      origin: "https://example.com",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new WebControlPlaneClient(config, fetchMock);

    const evidence = await client.runEvidence("auto/1", "run/1", 2);

    expect(evidence).toMatchObject({ kind: "BROWSER_STATE", ordinal: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(String(input)).toBe("https://control.example.com/v1/automations/auto%2F1/runs/run%2F1/evidence/2");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({ authorization: "Bearer server-session-token" });
    expect(JSON.stringify(init)).not.toContain("artifact");
  });

  it("rejects invalid ordinals before the control-plane request", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = new WebControlPlaneClient(config, fetchMock);

    await expect(client.runEvidence("auto-1", "run-1", 0)).rejects.toBeInstanceOf(WebControlPlaneError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
