import type { RunFailure } from "@automation/contracts";

export type ExecutionOperation =
  | "browser session setup"
  | "browser profile persistence"
  | "deterministic browser execution"
  | "semantic reasoning"
  | "semantic browser execution"
  | "effect verification"
  | "execution runtime cleanup";

/**
 * Provider and browser adapters use this error to surface a sanitized, domain-level
 * failure classification without leaking raw SDK errors into durable run state.
 */
export class ClassifiedExecutionError extends Error {
  readonly failure: RunFailure;

  constructor(failure: RunFailure, options?: ErrorOptions) {
    super(failure.message, options);
    this.name = "ClassifiedExecutionError";
    this.failure = structuredClone(failure);
  }
}

export function classifyExecutionError(
  error: unknown,
  nodeId: string,
  operation: ExecutionOperation,
): RunFailure {
  if (error instanceof ClassifiedExecutionError) {
    return {
      ...structuredClone(error.failure),
      nodeId: error.failure.nodeId ?? nodeId,
      evidenceRefs: [...error.failure.evidenceRefs],
    };
  }

  return {
    code: "UNKNOWN",
    message: `${operation} failed`,
    retryable: false,
    nodeId,
    evidenceRefs: [],
  };
}
