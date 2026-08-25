import Link from "next/link";
import { WebControlPlaneError } from "../../../lib/control-plane-client";
import { productionDeploymentReadiness } from "../../../lib/deployment-readiness";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../lib/server-auth";

export const dynamic = "force-dynamic";

export default async function DeploymentStatusPage() {
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    const dashboard = await client.dashboard();
    const readiness = productionDeploymentReadiness(dashboard.capabilities);

    return <>
      <section className="hero">
        <div>
          <div className="eyebrow">System status</div>
          <h1>Production deployment readiness</h1>
          <p>Check whether the authenticated product has every capability required for the cloud automation lifecycle before starting a live run.</p>
        </div>
        <div className="card subtle stack">
          <span className={readiness.kind === "READY" ? "badge" : "badge warning"}>{readiness.kind}</span>
          <p className="muted">This page is read-only. It does not allocate a browser, invoke a model, create a schedule, or mutate automation state.</p>
        </div>
      </section>
      <section className="grid two">
        {readiness.capabilities.map((capability) => <div className="card stack" key={capability.key}>
          <div className="row">
            <h2>{capability.label}</h2>
            <span className={capability.ready ? "badge" : "badge warning"}>{capability.state}</span>
          </div>
          <p className="muted">{capability.message}</p>
        </div>)}
      </section>
      <section className="card stack" style={{ marginTop: 18 }}>
        <h2>What production-ready means</h2>
        <p>Authentication, cloud capture, AgentCore execution, scheduling, and notifications must all report CONFIGURED. LOCAL_MOCK remains useful for development but is intentionally not treated as production readiness.</p>
        <p className="muted">Runtime ownership, tenant isolation, Browser Profile references, provider credentials, and deployment secrets remain server-side and are not exposed by this status view.</p>
        <Link href="/">Back to dashboard</Link>
      </section>
    </>;
  } catch (error) {
    if (error instanceof WebAuthError) {
      return <section className="card stack"><div className="eyebrow">Sign in required</div><h1>Authenticate to inspect deployment readiness.</h1><Link className="button" href="/api/auth/sign-in?returnTo=%2Fsettings%2Fstatus">Sign in with Google or email</Link></section>;
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return <section className="card stack"><div className="eyebrow">System status</div><h1>Control plane not configured</h1><p>The authenticated web application cannot reach a trusted control-plane endpoint, so production readiness cannot be established.</p><Link href="/">Back to dashboard</Link></section>;
    }
    return <section className="card stack"><div className="eyebrow">System status</div><h1>Readiness temporarily unavailable</h1><p>The status read failed safely. No provider or internal error details were exposed.</p><Link href="/">Back to dashboard</Link></section>;
  }
}
