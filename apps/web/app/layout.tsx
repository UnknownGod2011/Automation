import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Automation Cloud",
  description: "Teach, test, publish, and inspect cloud browser automations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">Automation Cloud</Link>
          <nav className="nav" aria-label="Primary navigation">
            <Link href="/">Dashboard</Link>
            <Link className="button small" href="/automations/new">New automation</Link>
          </nav>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
