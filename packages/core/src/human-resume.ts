import type { ExecutionResult } from "./execution.js";
import type {
  HumanResolutionCommand,
  HumanResolutionClaimResult,
  HumanResolutionCoordinator,
  ValidatedHumanResolution,
} from "./human-resolution.js";

export interface HumanResumeExecutionRequest {
  command: HumanResolutionCommand;
  validated: ValidatedHumanResolution;
}

/**
 * Production adapters may open browser/model compute only through this boundary.
 * The executor is invoked only for a newly ACCEPTED durable resolution claim.
 */
export interface HumanResumeExecutor {
  execute(request: HumanResumeExecutionRequest): Promise<ExecutionResult>;
}

export type HumanResumeOrchestrationResult =
  | {
      kind: "EXECUTED";
      claim: Extract<HumanResolutionClaimResult, { status: "ACCEPTED" }>;
      execution: ExecutionResult;
    }
  | {
      kind: "NOT_EXECUTED";
      claim: Extract<HumanResolutionClaimResult, { status: "REPLAY" | "CONFLICT" }>;
    };

export interface HumanResumeOrchestratorDependencies {
  resolutions: HumanResolutionCoordinator;
  executor: HumanResumeExecutor;
}

/**
 * Converts at-least-once human-resolution delivery into at-most-once resume
 * execution for one durable claim attempt. A replay is deliberately non-executing:
 * claim idempotency must never be interpreted as permission to repeat browser
 * side effects. Recovery after a worker dies following ACCEPTED is a separate,
 * durable lease/state-machine concern and therefore fails closed here.
 */
export class HumanResumeOrchestrator {
  constructor(private readonly dependencies: HumanResumeOrchestratorDependencies) {}

  async execute(command: HumanResolutionCommand): Promise<HumanResumeOrchestrationResult> {
    const validated = await this.dependencies.resolutions.claim(command);
    if (validated.result.status !== "ACCEPTED") {
      return { kind: "NOT_EXECUTED", claim: validated.result };
    }

    const execution = await this.dependencies.executor.execute({ command, validated });
    return {
      kind: "EXECUTED",
      claim: validated.result,
      execution,
    };
  }
}
