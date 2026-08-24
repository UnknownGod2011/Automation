import type { VerificationSpec, WorkflowNode } from "@automation/contracts";
import type { OwnershipScope } from "./index.js";
import type {
  HumanResumeEffectDecision,
  HumanResumeEffectIdentity,
  HumanResumeEffectRecord,
  HumanResumeEffectReconciliationStore,
} from "./human-resume-effect.js";

export interface HumanResumeEffectInspectionContext {
  scope: OwnershipScope;
  runId: string;
  humanNodeId: string;
  resolutionId: string;
  effectId: string;
  node: WorkflowNode;
  verification: VerificationSpec;
}

export interface HumanResumeEffectInspectionResult {
  decision: HumanResumeEffectDecision;
  evidenceRefs: readonly string[];
}

/**
 * Read-only runtime inspection boundary used after ownership loss. Implementations
 * may inspect browser/page state and invoke bounded reasoning, but must never execute
 * the workflow node or any other external side effect. If absence cannot be proven,
 * they must return AMBIGUOUS rather than DEFINITELY_NOT_APPLIED.
 */
export interface HumanResumeEffectVerifier {
  inspect(context: HumanResumeEffectInspectionContext): Promise<HumanResumeEffectInspectionResult>;
}

export interface HumanResumeEffectReconciliationResult {
  status: "DECIDED" | "REPLAY" | "CONFLICT";
  record: HumanResumeEffectRecord;
  evidenceRefs: readonly string[];
}

export interface HumanResumeEffectReconcilerDependencies {
  store: HumanResumeEffectReconciliationStore;
  verifier: HumanResumeEffectVerifier;
  now?: () => Date;
}

function assertDecision(decision: HumanResumeEffectDecision): HumanResumeEffectDecision {
  if (
    decision !== "ALREADY_APPLIED" &&
    decision !== "DEFINITELY_NOT_APPLIED" &&
    decision !== "AMBIGUOUS"
  ) {
    throw new Error("invalid human resume reconciliation verifier decision");
  }
  return decision;
}

function assertBoundary(identity: HumanResumeEffectIdentity, node: WorkflowNode): VerificationSpec {
  if (node.id !== identity.successorNodeId) {
    throw new Error("reconciliation node does not match prepared successor identity");
  }
  if (node.kind === "HUMAN" || node.kind === "END") {
    throw new Error("reconciliation requires an executable successor node");
  }
  if (node.allowedSideEffects.length === 0) {
    throw new Error("reconciliation is only valid for a side-effecting successor");
  }
  if (!node.verification) {
    throw new Error("reconciliation requires the successor verification contract");
  }
  return node.verification;
}

/**
 * Provider-neutral reconciliation coordinator. It establishes the durable effect
 * identity before any runtime inspection, then persists exactly one immutable
 * three-way decision. Existing durable decisions are authoritative and are returned
 * without invoking the verifier again.
 */
export class HumanResumeEffectReconciler {
  private readonly now: () => Date;

  constructor(private readonly dependencies: HumanResumeEffectReconcilerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async reconcile(
    identity: HumanResumeEffectIdentity,
    node: WorkflowNode,
  ): Promise<HumanResumeEffectReconciliationResult> {
    const verification = assertBoundary(identity, node);
    const prepared = await this.dependencies.store.prepare(identity, this.now().toISOString());

    if (prepared.status === "CONFLICT") {
      return { status: "CONFLICT", record: prepared.record, evidenceRefs: [] };
    }

    if (prepared.record.state === "DECIDED") {
      return { status: "REPLAY", record: prepared.record, evidenceRefs: [] };
    }

    const inspection = await this.dependencies.verifier.inspect({
      scope: { tenantId: identity.tenantId, userId: identity.userId },
      runId: identity.runId,
      humanNodeId: identity.humanNodeId,
      resolutionId: identity.resolutionId,
      effectId: identity.effectId,
      node,
      verification,
    });
    const decision = assertDecision(inspection.decision);

    const decided = await this.dependencies.store.decide(
      identity,
      decision,
      this.now().toISOString(),
    );

    return {
      status: decided.status,
      record: decided.record,
      evidenceRefs: inspection.evidenceRefs,
    };
  }
}
