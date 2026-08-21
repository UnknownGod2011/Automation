import type { WorkflowInspectionView } from "@automation/core";

export function WorkflowInspectionCard({ workflow }: { workflow: WorkflowInspectionView }) {
  return (
    <div className="card subtle stack" style={{ marginTop: 12 }}>
      <div className="row">
        <strong>Compiled workflow v{workflow.version}</strong>
        <span className="badge">{workflow.totalNodeCount} steps</span>
      </div>
      <p>
        Review the semantic plan before spending a fresh test. Selectors, captured values,
        variable names, verification expected values, and provider/browser credentials are hidden.
      </p>
      <div className="list">
        {workflow.nodes.map((node) => (
          <div className="list-item" key={node.step}>
            <div>
              <div className="eyebrow">Step {node.step}</div>
              <h3>{node.kind}</h3>
              <p>{node.objective}</p>
            </div>
            <div className="stack">
              <span className="muted">
                Effect: {node.allowedSideEffects.length > 0 ? node.allowedSideEffects.join(", ") : "None"}
              </span>
              <span className="muted">
                Verification: {node.verification ? node.verification.mode : "Not required"}
              </span>
            </div>
            <div className="stack">
              <span className="muted">Attempts: {node.maxAttempts}</span>
              <span className="muted">
                Next: {node.nextSteps.length > 0 ? node.nextSteps.map((step) => `Step ${step}`).join(", ") : "Complete"}
              </span>
            </div>
          </div>
        ))}
      </div>
      {workflow.truncated ? (
        <p className="muted">
          This workflow has more than {workflow.nodes.length} steps. The inspection view is intentionally bounded;
          execution still uses the complete immutable workflow.
        </p>
      ) : null}
    </div>
  );
}
