import { useCallback, useEffect, useMemo, useState } from "react";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import AccountPage from "./components/AccountPage";
import AgentsPage from "./components/AgentsPage";
import Dashboard from "./components/Dashboard";
import DocsPage from "./components/DocsPage";
import LandingPage from "./components/LandingPage";

type AuthedRoute =
  | { key: "dashboard" }
  | { key: "agentsList" }
  | { key: "agentDetail"; agentId: string }
  | { key: "account" }
  | { key: "docs" };

function parseAuthedSearch(search: string): AuthedRoute {
  // Query-string routing to avoid conflicts with in-page anchors (hash).
  //
  // Supported:
  // - ?page=dashboard
  // - ?page=agents
  // - ?page=agent&agentId=<agentId>
  // - ?page=account
  // - ?page=docs
  // Back-compat:
  // - ?agentId=<agentId> implies agent detail
  const sp = new URLSearchParams(search || "");
  const pageRaw = (sp.get("page") || "").trim().toLowerCase();

  const agentId = (sp.get("agentId") || "").trim();
  if (pageRaw === "agent" || pageRaw === "agentdetail") {
    return agentId ? { key: "agentDetail", agentId } : { key: "agentsList" };
  }

  if (pageRaw === "agents" || pageRaw === "agentslist") return { key: "agentsList" };
  if (pageRaw === "account") return { key: "account" };
  if (pageRaw === "docs" || pageRaw === "documentation") return { key: "docs" };
  if (pageRaw === "dashboard" || pageRaw === "") {
    // If agentId is present without an explicit page, treat it as a deep-link to detail.
    if (agentId) return { key: "agentDetail", agentId };
    return { key: "dashboard" };
  }

  // Unknown page => default
  return agentId ? { key: "agentDetail", agentId } : { key: "dashboard" };
}

function setAuthedSearch(route: AuthedRoute, mode: "push" | "replace" = "push"): void {
  const url = new URL(window.location.href);

  // Preserve hash for in-page anchors. Only change query params.
  if (route.key === "dashboard") {
    url.searchParams.set("page", "dashboard");
    url.searchParams.delete("agentId");
  } else if (route.key === "account") {
    url.searchParams.set("page", "account");
    url.searchParams.delete("agentId");
  } else if (route.key === "docs") {
    url.searchParams.set("page", "docs");
    url.searchParams.delete("agentId");
  } else if (route.key === "agentsList") {
    url.searchParams.set("page", "agents");
    url.searchParams.delete("agentId");
  } else {
    url.searchParams.set("page", "agent");
    url.searchParams.set("agentId", route.agentId);
  }

  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "replace") window.history.replaceState({}, "", next);
  else window.history.pushState({}, "", next);

  window.dispatchEvent(new Event("wh:locationchange"));
}

export default function App() {
  const [route, setRoute] = useState<AuthedRoute>(() =>
    parseAuthedSearch(window.location.search),
  );

  // Emit a custom location-change event when code calls pushState/replaceState.
  // (This app uses query-string routing, so hash stays reserved for in-page anchors.)
  useEffect(() => {
    const dispatch = () => window.dispatchEvent(new Event("wh:locationchange"));

    const h = window.history as any;
    const origPush = h.pushState;
    const origReplace = h.replaceState;

    h.pushState = function (...args: any[]) {
      const ret = origPush.apply(this, args);
      dispatch();
      return ret;
    };

    h.replaceState = function (...args: any[]) {
      const ret = origReplace.apply(this, args);
      dispatch();
      return ret;
    };

    window.addEventListener("popstate", dispatch);
    return () => {
      window.removeEventListener("popstate", dispatch);
      h.pushState = origPush;
      h.replaceState = origReplace;
    };
  }, []);

  useEffect(() => {
    const onLocationChange = () => setRoute(parseAuthedSearch(window.location.search));
    window.addEventListener("wh:locationchange", onLocationChange);
    return () => window.removeEventListener("wh:locationchange", onLocationChange);
  }, []);

  const activeNavKey: "dashboard" | "agents" | "account" | "docs" =
    route.key === "dashboard"
      ? "dashboard"
      : route.key === "account"
        ? "account"
        : route.key === "docs"
          ? "docs"
          : "agents";

  const authedNav = useMemo(
    () =>
      [
        { key: "dashboard" as const, label: "Dashboard" },
        { key: "agents" as const, label: "Agents" },
        { key: "account" as const, label: "Account" },
        { key: "docs" as const, label: "Documentation" },
      ] satisfies Array<{ key: "dashboard" | "agents" | "account" | "docs"; label: string }>,
    [],
  );



  const goNav = useCallback((key: "dashboard" | "agents" | "account" | "docs") => {
    if (key === "dashboard") setAuthedSearch({ key: "dashboard" });
    else if (key === "account") setAuthedSearch({ key: "account" });
    else if (key === "docs") setAuthedSearch({ key: "docs" });
    else setAuthedSearch({ key: "agentsList" });
  }, []);

  return (
    <div className="page">
      <SignedOut>
        <header className="header">
          <div className="container header-inner">
            <div className="brand" style={{ gap: 4 }}>
              <div className="brand-title">
                <a href="https://webhost.systems">WebHost.Systems</a>
              </div>
              <div className="brand-subtitle">AI Systems for Web Hosts</div>
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
                <div className="brand-title">
                  <a href="https://webhost.systems">WebHost.Systems</a>
                </div>
                <div className="brand-subtitle">AI Systems for Web Hosts</div>
              </div>

              <nav className="acp-nav" aria-label="Dashboard navigation">
                {authedNav.map((item) => {
                  const active = activeNavKey === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={active ? "button button-primary" : "button"}
                      aria-current={active ? "page" : undefined}
                      onClick={() => goNav(item.key)}
                      title={item.label}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>

              {activeNavKey === "agents" ? (
                route.key === "agentsList" ? (
                  <nav className="acp-nav-sections" aria-label="Agents list sections">
                    <a className="button" href="#agents">
                      Agents list
                    </a>
                  </nav>
                ) : (
                  <nav className="acp-nav-sections" aria-label="Agent detail sections">
                    <button
                      type="button"
                      className="button"
                      onClick={() => setAuthedSearch({ key: "agentsList" })}
                      title="Back to agents list"
                    >
                      ← Back
                    </button>
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
                )
              ) : activeNavKey === "docs" ? (
                <nav className="acp-nav-sections" aria-label="Documentation sections">
                  <a className="button" href="#spec">
                    Spec
                  </a>
                  <a className="button" href="#quickstart">
                    Quickstart
                  </a>
                  <a className="button" href="#endpoints">
                    Endpoints
                  </a>
                </nav>
              ) : activeNavKey === "account" ? (
                <nav className="acp-nav-sections" aria-label="Account sections">
                  <a className="button" href="#identity">
                    Identity
                  </a>
                  <a className="button" href="#usage">
                    Tier & usage
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
            {route.key === "dashboard" ? (
              <Dashboard />
            ) : route.key === "agentsList" ? (
              <AgentsPage
                mode="list"
                onNavigateToAgent={(agentId) =>
                  setAuthedSearch({ key: "agentDetail", agentId })
                }
              />
            ) : route.key === "agentDetail" ? (
              <AgentsPage
                mode="detail"
                agentId={route.agentId}
                onBackToList={() => setAuthedSearch({ key: "agentsList" })}
              />
            ) : route.key === "account" ? (
              <AccountPage />
            ) : (
              <DocsPage />
            )}
          </div>
        </div>
      </SignedIn>
    </div>
  );
}
