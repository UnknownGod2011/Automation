import { describe, expect, it } from "vitest";
import type { CaptureTrace } from "@automation/contracts";
import { compileCaptureTrace } from "./workflow-compiler.js";

function fixture(): CaptureTrace {
  return {
    schemaVersion: 1,
    traceId: "trace-1",
    tenantId: "tenant-1",
    userId: "user-1",
    automationId: "automation-1",
    websiteUrl: "https://app.example.com",
    objective: "Open a customer, add a note, and save it",
    browserProfileRef: "profile-1",
    startedAt: "2026-08-19T10:00:00.000Z",
    finishedAt: "2026-08-19T10:01:00.000Z",
    events: [
      { eventId: "login-email", sequence: 1, kind: "INPUT", purpose: "AUTH_SETUP", occurredAt: "2026-08-19T10:00:05.000Z", page: { url: "https://app.example.com/login" }, target: { role: "textbox", accessibleName: "Email" }, input: { kind: "RUNTIME_VARIABLE", variableName: "auth.email", sensitive: true }, artifactRefs: [] },
      { eventId: "open-customers", sequence: 2, kind: "NAVIGATION", purpose: "WORKFLOW", occurredAt: "2026-08-19T10:00:20.000Z", page: { url: "https://app.example.com/customers" }, navigationUrl: "https://app.example.com/customers", artifactRefs: [{ ref: "artifact/nav-before", kind: "SCREENSHOT", contentType: "image/png" }] },
      { eventId: "select-customer", sequence: 3, kind: "CLICK", purpose: "WORKFLOW", occurredAt: "2026-08-19T10:00:30.000Z", page: { url: "https://app.example.com/customers" }, target: { role: "link", accessibleName: "Acme Ltd", testId: "customer-acme" }, expectedEffect: { description: "Customer detail opened", mode: "URL", expected: "https://app.example.com/customers/acme", timeoutMs: 10_000 }, artifactRefs: [] },
      { eventId: "note", sequence: 4, kind: "INPUT", purpose: "WORKFLOW", occurredAt: "2026-08-19T10:00:40.000Z", page: { url: "https://app.example.com/customers/acme" }, target: { role: "textbox", accessibleName: "Note", testId: "note" }, input: { kind: "PUBLIC_LITERAL", value: "Follow up next Tuesday" }, expectedEffect: { description: "Note field is populated", mode: "DOM", expected: "[data-testid='note']", timeoutMs: 5_000 }, artifactRefs: [] },
      { eventId: "save", sequence: 5, kind: "SUBMIT", purpose: "WORKFLOW", occurredAt: "2026-08-19T10:00:50.000Z", page: { url: "https://app.example.com/customers/acme" }, target: { role: "button", accessibleName: "Save", testId: "save" }, expectedEffect: { description: "Save confirmation appears", mode: "TEXT", expected: "Saved", timeoutMs: 10_000 }, artifactRefs: [] },
      { eventId: "scroll-noise", sequence: 6, kind: "SCROLL", purpose: "WORKFLOW", occurredAt: "2026-08-19T10:00:55.000Z", page: { url: "https://app.example.com/customers/acme" }, artifactRefs: [] },
    ],
  };
}

describe("compileCaptureTrace", () => {
  it("compiles a realistic capture into a deterministic verified graph", () => {
    const graph = compileCaptureTrace({ trace: fixture(), workflowId: "workflow-1", version: 1, createdAt: "2026-08-19T11:00:00Z" });
    expect(graph.entryNodeId).toBe("capture-2-open-customers");
    expect(Object.keys(graph.nodes)).toEqual(["capture-2-open-customers", "capture-3-select-customer", "capture-4-note", "capture-5-save", "end"]);
    expect(graph.nodes["capture-3-select-customer"]?.deterministicStrategies[0]).toEqual({ kind: "TEST_ID", value: "customer-acme", confidence: 1 });
    expect(graph.nodes["capture-4-note"]?.inputBindings).toEqual({ value: "capture.note.value" });
    expect(graph.initialVariables).toEqual({ "capture.note.value": "Follow up next Tuesday" });
    expect(JSON.stringify(graph)).not.toContain("auth.email");
  });

  it("preserves capture-generated CUSTOM effect verification instead of weakening side-effect gates", () => {
    const trace = fixture();
    const events = trace.events.map((event) => {
      if (event.eventId === "note") {
        return {
          ...event,
          input: { kind: "RUNTIME_VARIABLE" as const, variableName: "runtime.note", sensitive: true },
          expectedEffect: {
            description: "Captured input target remains populated after typing",
            mode: "CUSTOM" as const,
            expected: "capture:input-filled",
            timeoutMs: 5_000,
          },
        };
      }
      if (event.eventId === "save") {
        return {
          ...event,
          expectedEffect: {
            description: "Browser structure matches the demonstrated post-action state",
            mode: "CUSTOM" as const,
            expected: "capture:state:abc123",
            timeoutMs: 10_000,
          },
        };
      }
      return event;
    });
    const graph = compileCaptureTrace({ trace: { ...trace, events }, workflowId: "workflow-capture-custom", version: 1, createdAt: "2026-08-19T11:00:00Z" });
    expect(graph.nodes["capture-4-note"]?.verification).toMatchObject({ mode: "CUSTOM", expected: "capture:input-filled" });
    expect(graph.nodes["capture-5-save"]?.verification).toMatchObject({ mode: "CUSTOM", expected: "capture:state:abc123" });
  });

  it("synthesizes fresh-run navigation when workflow capture begins on an existing page", () => {
    const trace = fixture();
    const events = trace.events.filter((event) => event.eventId !== "open-customers").map((event, index) => ({ ...event, sequence: index + 1 }));
    const graph = compileCaptureTrace({ trace: { ...trace, events }, workflowId: "workflow-start", version: 1, createdAt: "2026-08-19T11:00:00Z" });
    expect(graph.entryNodeId).toBe("capture-start");
    expect(graph.nodes["capture-start"]?.kind).toBe("NAVIGATE");
    expect(graph.nodes["capture-start"]?.deterministicStrategies).toEqual([{ kind: "URL", value: "https://app.example.com/customers", confidence: 1 }]);
    expect(graph.nodes["capture-start"]?.next).toEqual(["capture-2-select-customer"]);
  });

  it("keeps sensitive workflow input as an unmaterialized runtime variable", () => {
    const trace = fixture();
    const events = trace.events.map((event) => event.eventId === "note" ? { ...event, input: { kind: "RUNTIME_VARIABLE" as const, variableName: "runtime.note", sensitive: true } } : event);
    const graph = compileCaptureTrace({ trace: { ...trace, events }, workflowId: "workflow-2", version: 1, createdAt: "2026-08-19T11:00:00Z" });
    expect(graph.nodes["capture-4-note"]?.inputBindings).toEqual({ value: "runtime.note" });
    expect(graph.initialVariables).toEqual({});
  });

  it("fails closed when a side-effecting captured action has no expected effect", () => {
    const trace = fixture();
    const events = trace.events.map((event) => {
      if (event.eventId !== "save") return event;
      const { expectedEffect: _expectedEffect, ...withoutEffect } = event;
      return withoutEffect;
    });
    expect(() => compileCaptureTrace({ trace: { ...trace, events }, workflowId: "workflow-3", version: 1, createdAt: "2026-08-19T11:00:00Z" })).toThrow("requires an expected effect");
  });

  it("rejects trace ordering drift before compilation", () => {
    const trace = fixture();
    const events = trace.events.map((event) => event.eventId === "select-customer" ? { ...event, sequence: 9 } : event);
    expect(() => compileCaptureTrace({ trace: { ...trace, events }, workflowId: "workflow-4", version: 1, createdAt: "2026-08-19T11:00:00Z" })).toThrow("sequence must be contiguous");
  });
});
