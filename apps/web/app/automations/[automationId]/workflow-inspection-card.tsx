import Link from "next/link";
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
        arbitrary variable names, verification expected values, and provider/browser credentials are hidden.
      </p>
      <p className="muted">
        Retained capture screenshots are supplementary teaching evidence, not execution or verification authority.
      </p>
      {workflow.automationId ? (
        <Link href={`/automations/${encodeURIComponent(workflow.automationId)}/capture-evidence`}>
          Review capture screenshots
        </Link>
      ) : null}
      {workflow.runtimeInputs.length > 0 ? (
        <div className="notice stack">
          <strong>Fresh test needs {workflow.runtimeInputs.length} runtime {workflow.runtimeInputs.length === 1 ? "value" : "values"}</strong>
          <p>
            Typed and selected values were deliberately not stored during capture. Use the guided Fresh Test input
            screen to provide each value by semantic step; the browser does not need to send internal workflow
            variable names back to the server.
          </p>
          <div className="stack">
            {workflow.runtimeInputs.map((input) => (
              <span key={`${input.step}-${input.key}`}>Step {input.step} · runtime value required</span>
            ))}
          </div>
          {workflow.automationId ? (
            <Link
              className="button secondary"
              href={`/automations/${encodeURIComponent(workflow.automationId)}/fresh-test`}
            >
              Enter Fresh Test values
            </Link>
          ) : null}
          <p className="muted">
            Do not enter passwords, OTPs, API keys, or other secrets. Fresh Test values can become part of durable
            run checkpoint state; target-site authentication belongs in the persisted Browser Profile. Scheduled runs
            still require explicitly non-secret reusable values configured at publish time.
          </p>
        </div>
      ) : null}
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
