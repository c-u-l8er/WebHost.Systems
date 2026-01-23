import { useMemo, useState } from "react";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import Dashboard from "./components/Dashboard";
import AgentsPage from "./components/AgentsPage";
import LandingPage from "./components/LandingPage";

type AuthedRoute = "dashboard" | "agents" | "account" | "docs";

export default function App() {
  const [route, setRoute] = useState<AuthedRoute>("dashboard");

  const authedNav = useMemo(
    () =>
      [
        { key: "dashboard" as const, label: "Dashboard" },
        { key: "agents" as const, label: "Agents" },
        { key: "account" as const, label: "Account" },
        { key: "docs" as const, label: "Docs" },
      ] satisfies Array<{ key: AuthedRoute; label: string }>,
    [],
  );

  return (
    <div className="page">
      <SignedOut>
        <header className="header">
          <div className="container header-inner">
            <div className="brand" style={{ gap: 4 }}>
              <div className="brand-title">webhost.systems</div>
              <div className="brand-subtitle">
                Deploy, run, and observe AI agents across runtimes
              </div>
            </div>

            <div className="row">
              <nav className="row" aria-label="Marketing">
                <a className="muted" href="#product">
                  Product
                </a>
                <a className="muted" href="#how-it-works">
                  How it works
                </a>
                <a className="muted" href="#pricing">
                  Pricing
                </a>
              </nav>

              <div style={{ width: 10 }} />

              <a
                className="button button-primary"
                href="https://github.com/c-u-l8er/WebHost.Systems"
                target="_blank"
                rel="noreferrer"
              >
                Open source
              </a>
            </div>
          </div>
        </header>

        <main className="main">
          <div className="container">
            <LandingPage />
          </div>
        </main>
      </SignedOut>

      <SignedIn>
        <div className="acp-shell">
          <aside className="acp-sidebar" aria-label="Admin sidebar">
            <div className="acp-sidebar-inner">
              <div className="brand" style={{ gap: 4 }}>
                <div className="brand-title">webhost.systems</div>
                <div className="brand-subtitle">Admin Control Panel</div>
              </div>

              <nav className="acp-nav" aria-label="Dashboard navigation">
                {authedNav.map((item) => {
                  const active = route === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={active ? "button button-primary" : "button"}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setRoute(item.key)}
                      title={item.label}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>

              {route === "agents" ? (
                <nav className="acp-nav-sections" aria-label="Agents sections">
                  <a className="button" href="#agents">
                    Agents
                  </a>
                  <a className="button" href="#agent">
                    Selected agent
                  </a>
                  <a className="button" href="#deploy">
                    Deploy
                  </a>
                  <a className="button" href="#invoke">
                    Invoke
                  </a>
                  <a className="button" href="#deployments">
                    Deployments
                  </a>
                  <a className="button" href="#rollback">
                    Rollback
                  </a>
                  <a className="button" href="#telemetry">
                    Telemetry
                  </a>
                </nav>
              ) : (
                <div className="acp-nav-sections">
                  <div className="muted" style={{ fontSize: 12 }}>
                    Open Agents to jump to sections.
                  </div>
                </div>
              )}

              <div className="spacer" />

              <div className="row" style={{ justifyContent: "space-between" }}>
                <UserButton />
              </div>
            </div>
          </aside>

          <div className="acp-main">
            {route === "dashboard" ? (
              <Dashboard />
            ) : route === "agents" ? (
              <AgentsPage />
            ) : route === "account" ? (
              <div className="panel">
                <div className="panel-header">
                  <div className="row">
                    <strong>Account</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">coming soon</span>
                    </span>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="muted">
                    This section is reserved for subscription tier, billing
                    status, and security settings.
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel">
                <div className="panel-header">
                  <div className="row">
                    <strong>Docs</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">spec-first</span>
                    </span>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="muted" style={{ marginBottom: 10 }}>
                    This dashboard is driven by the v1 spec and ADRs.
                  </div>
                  <div className="row">
                    <a className="button" href="#product">
                      Overview
                    </a>
                    <a className="button" href="#how-it-works">
                      Flows
                    </a>
                    <a className="button" href="#pricing">
                      Tiers
                    </a>
                  </div>
                  <div className="muted" style={{ marginTop: 10 }}>
                    (Hook this up to real docs or a hosted spec site when you’re
                    ready.)
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </SignedIn>
    </div>
  );
}
