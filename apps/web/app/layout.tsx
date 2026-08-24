import type { Metadata } from "next";
import Link from "next/link";
import { authenticatedNavigationPresentation } from "../lib/navigation-readiness";
import { newAutomationAccess } from "../lib/new-automation-access";
import { getWebAuthStatus } from "../lib/server-auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Automation Cloud",
  description: "Teach, test, publish, and inspect cloud browser automations.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await getWebAuthStatus();
  const authenticatedNavigation = auth.kind === "AUTHENTICATED"
    ? authenticatedNavigationPresentation(newAutomationAccess(auth))
    : null;

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">Automation Cloud</Link>
          <nav className="nav" aria-label="Primary navigation">
            <Link href="/">Dashboard</Link>
            {auth.kind === "AUTHENTICATED" ? (
              <>
                {authenticatedNavigation?.kind === "READY" ? (
                  <>
                    <Link href="/settings/credentials">Credentials</Link>
                    <Link href="/settings/inputs">Inputs</Link>
                    <Link href="/settings/notifications">Notifications</Link>
                    <Link className="button small" href="/automations/new">New automation</Link>
                  </>
                ) : (
                  <span className="badge warning" title={authenticatedNavigation?.message}>Control plane unavailable</span>
                )}
                <form action="/api/auth/sign-out" method="post"><button className="button small secondary" type="submit">Sign out</button></form>
              </>
            ) : auth.kind === "SIGNED_OUT" ? (
              <Link className="button small" href="/api/auth/sign-in">Sign in</Link>
            ) : null}
          </nav>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
