import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import type { CheckpointRepository, OwnershipScope, RunRepository } from "./index.js";

export interface HumanResolutionCommand {
  scope: OwnershipScope;
  runId: string;
  expectedNodeId: string;
  resolutionId: string;
}

export interface HumanResolutionClaim {
  tenantId: string;
  userId: string;
  runId: string;
  nodeId: string;
  resolutionId: string;
  acceptedAt: string;
}

export type HumanResolutionClaimResult =
  | { status: "ACCEPTED"; claim: HumanResolutionClaim }
  | { status: "REPLAY"; claim: HumanResolutionClaim }
  | { status: "CONFLICT"; claim: HumanResolutionClaim };

/**
 * Atomically establishes one accepted human-resolution command for a paused
 * run/node boundary. Durable adapters must make the check-and-create operation
 * conditional; a read followed by an unconditional write is not sufficient.
 */
export interface HumanResolutionClaimStore {
  claim(command: HumanResolutionCommand, acceptedAt: string): Promise<HumanResolutionClaimResult>;
  get(scope: OwnershipScope, runId: string, nodeId: string): Promise<HumanResolutionClaim | null>;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 512) throw new Error(`${label} is too long`);
  return normalized;
}

function claimKey(scope: OwnershipScope, runId: string, nodeId: string): string {
  return `${scope.tenantId}:${scope.userId}:${runId}:${nodeId}`;
}

const clone = <T>(value: T): T => structuredClone(value);

/** Deterministic local/test adapter. Cloud adapters must provide durable atomicity. */
export class InMemoryHumanResolutionClaimStore implements HumanResolutionClaimStore {
  private readonly claims = new Map<string, HumanResolutionClaim>();

  async claim(
    command: HumanResolutionCommand,
    acceptedAt: string,
  ): Promise<HumanResolutionClaimResult> {
    const runId = required(command.runId, "runId");
    const nodeId = required(command.expectedNodeId, "expectedNodeId");
    const resolutionId = required(command.resolutionId, "resolutionId");
    const acceptedInstant = new Date(acceptedAt);
    if (Number.isNaN(acceptedInstant.getTime())) {
      throw new Error("acceptedAt must be an ISO-8601 timestamp");
    }

    const key = claimKey(command.scope, runId, nodeId);
    const existing = this.claims.get(key);
    if (existing) {
      return {
        status: existing.resolutionId === resolutionId ? "REPLAY" : "CONFLICT",
        claim: clone(existing),
      };
    }

    const claim: HumanResolutionClaim = {
      tenantId: command.scope.tenantId,
      userId: command.scope.userId,
      runId,
      nodeId,
      resolutionId,
      acceptedAt: acceptedInstant.toISOString(),
    };
    this.claims.set(key, claim);
    return { status: "ACCEPTED", claim: clone(claim) };
  }

  async get(
    scope: OwnershipScope,
    runId: string,
    nodeId: string,
  ): Promise<HumanResolutionClaim | null> {
    const value = this.claims.get(
      claimKey(scope, required(runId, "runId"), required(nodeId, "nodeId")),
    );
    return value ? clone(value) : null;
  }
}

export interface HumanResolutionCoordinatorDependencies {
  runs: RunRepository;
  checkpoints: CheckpointRepository;
  claims: HumanResolutionClaimStore;
  now?: () => Date;
}

export interface ValidatedHumanResolution {
  result: HumanResolutionClaimResult;
  run: RunRecord;
  checkpoint: RunCheckpoint;
}

/**
 * Validates the durable pause boundary before claiming a resolution command.
 * Only an ACCEPTED result is permission for a caller to start resume execution;
 * REPLAY and CONFLICT are deliberately non-executing outcomes.
 */
export class HumanResolutionCoordinator {
  private readonly now: () => Date;

  constructor(private readonly dependencies: HumanResolutionCoordinatorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async claim(command: HumanResolutionCommand): Promise<ValidatedHumanResolution> {
    required(command.scope.tenantId, "tenantId");
    required(command.scope.userId, "userId");
    const runId = required(command.runId, "runId");
    const expectedNodeId = required(command.expectedNodeId, "expectedNodeId");
    required(command.resolutionId, "resolutionId");

    const [run, checkpoint] = await Promise.all([
      this.dependencies.runs.get(command.scope, runId),
      this.dependencies.checkpoints.get(command.scope, runId),
    ]);

    if (!run) throw new Error(`run '${runId}' does not exist in the requested scope`);
    if (run.status !== "WAITING_FOR_HUMAN") {
      throw new Error(`run '${runId}' is not waiting for human resolution`);
    }
    if (!checkpoint) {
      throw new Error(`run '${runId}' has no durable checkpoint for human resolution`);
    }
    if (checkpoint.runId !== run.runId || checkpoint.automationId !== run.automationId) {
      throw new Error("human-resolution checkpoint identity does not match run");
    }
    if (checkpoint.workflowVersion !== run.workflowVersion) {
      throw new Error("human-resolution checkpoint workflow version does not match run");
    }
    if (checkpoint.currentNodeId !== expectedNodeId) {
      throw new Error(
        `human resolution expected node '${expectedNodeId}' but durable checkpoint is '${checkpoint.currentNodeId}'`,
      );
    }
    if (run.currentNodeId && run.currentNodeId !== expectedNodeId) {
      throw new Error(
        `human resolution expected node '${expectedNodeId}' but run is at '${run.currentNodeId}'`,
      );
    }

    const result = await this.dependencies.claims.claim(
      { ...command, runId, expectedNodeId },
      this.now().toISOString(),
    );
    return { result, run, checkpoint };
  }
}
