import type { RunRecord } from "@automation/contracts";
import type {
  CreateRunResult,
  OwnershipScope,
  RunRepository,
} from "./index.js";

export interface RunSuccessFinalizer {
  beforeSuccess(run: RunRecord): Promise<void>;
}

/**
 * Decorates durable run updates so external state that is required for a valid
 * success (for example a persisted browser profile) is committed before the
 * terminal SUCCEEDED record becomes visible.
 */
export class FinalizingRunRepository implements RunRepository {
  constructor(
    private readonly delegate: RunRepository,
    private readonly finalizer: RunSuccessFinalizer,
  ) {}

  async createIfAbsent(run: RunRecord): Promise<CreateRunResult> {
    return this.delegate.createIfAbsent(run);
  }

  async get(
    scope: OwnershipScope,
    runId: string,
  ): Promise<RunRecord | null> {
    return this.delegate.get(scope, runId);
  }

  async update(run: RunRecord): Promise<void> {
    if (run.status === "SUCCEEDED") {
      await this.finalizer.beforeSuccess(run);
    }
    await this.delegate.update(run);
  }

  async listForAutomation(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<readonly RunRecord[]> {
    return this.delegate.listForAutomation(scope, automationId);
  }
}
