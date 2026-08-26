import { describe, expect, it, vi } from "vitest";
import {
  WebControlPlaneClient,
  type FetchLike,
} from "./control-plane-client.js";

describe("unsupported capture control web classification", () => {
  it("preserves only the closed unsupported-control code and hides upstream detail", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "UNSUPPORTED_CAPTURE_CONTROL",
            message: "private compiler event id and selector detail",
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-token" },
      fetchImpl,
    );

    await expect(client.command("auto-1", "compile", {})).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPTURE_CONTROL",
      message: "Captured workflow contains an unsupported form control",
    });
  });

  it("keeps ordinary 409 responses on the generic conflict path", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({ error: { code: "CONFLICT", message: "private detail" } }),
        { status: 409 },
      ),
    );
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-token" },
      fetchImpl,
    );

    await expect(client.command("auto-1", "compile", {})).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Control-plane request conflicted with current state",
    });
  });
});
