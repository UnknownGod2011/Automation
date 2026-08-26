import Link from "next/link";

export default async function UnsupportedCaptureControlPage({
  params,
}: {
  params: Promise<{ automationId: string }>;
}) {
  const { automationId } = await params;
  return (
    <section className="card stack">
      <div className="eyebrow">Capture needs correction</div>
      <h1>This workflow contains a form control that cannot be replayed safely yet.</h1>
      <p>
        Compilation stopped before Fresh Test or cloud execution. Record a corrected workflow using
        controls the current runtime supports, or simplify that interaction so the automation does
        not guess at an unsupported browser action.
      </p>
      <p className="muted">
        Passwords and target-site authentication should stay in the Browser Profile rather than in
        replayable workflow inputs. No compiler, selector, browser-session, or provider details were
        exposed by this failure.
      </p>
      <Link
        className="button"
        href={`/automations/${encodeURIComponent(automationId)}#capture-workflow`}
      >
        Back and record a corrected workflow
      </Link>
    </section>
  );
}
