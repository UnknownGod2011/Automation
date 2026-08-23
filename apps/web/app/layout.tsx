import type { Metadata } from "next";
import Link from "next/link";
import { getWebAuthStatus } from "../lib/server-auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Automation Cloud",
  description: "Teach, test, publish, and inspect cloud browser automations.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await getWebAuthStatus();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">Automation Cloud</Link>
          <nav className="nav" aria-label="Primary navigation">
            <Link href="/">Dashboard</Link>
            {auth.kind === "AUTHENTICATED" ? (
              <>
                <Link href="/settings/credentials">Credentials</Link>
                <Link href="/settings/inputs">Inputs</Link>
                <Link href="/settings/notifications">Notifications</Link>
                <Link className="button small" href="/automations/new">New automation</Link>
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
