import { useCallback, useEffect, useMemo, useState } from "react";
import { useSupabaseAuth } from "./lib/SupabaseAuthProvider";
import AccountPage from "./components/AccountPage";
import AgentsPage from "./components/AgentsPage";
import AuthPage, { type AuthMode } from "./components/AuthPage";
import Dashboard from "./components/Dashboard";
import DocsPage from "./components/DocsPage";
import LandingPage from "./components/LandingPage";

// ---------------------------------------------------------------------------
// Route types
// ---------------------------------------------------------------------------

type Route =
  // Public auth routes
  | { key: "landing" }
  | { key: "auth"; mode: AuthMode; redirectTo?: string }
  // Protected routes
  | { key: "dashboard" }
  | { key: "agentsList" }
  | { key: "agentDetail"; agentId: string }
  | { key: "account" }
  | { key: "docs" };

// Auth page values
const AUTH_PAGES = new Set(["login", "signup", "callback", "reset-password", "update-password"]);

function parseRoute(search: string): Route {
  const sp = new URLSearchParams(search || "");
  const pageRaw = (sp.get("page") || "").trim().toLowerCase();
  const redirectTo = sp.get("redirectTo") || undefined;

  // Auth routes (public)
  if (AUTH_PAGES.has(pageRaw)) {
    return { key: "auth", mode: pageRaw as AuthMode, redirectTo };
  }

  // Protected routes
  const agentId = (sp.get("agentId") || "").trim();
  if (pageRaw === "agent" || pageRaw === "agentdetail") {
    return agentId ? { key: "agentDetail", agentId } : { key: "agentsList" };
  }

  if (pageRaw === "agents" || pageRaw === "agentslist") return { key: "agentsList" };
  if (pageRaw === "account") return { key: "account" };
  if (pageRaw === "docs" || pageRaw === "documentation") return { key: "docs" };
  if (pageRaw === "dashboard") return { key: "dashboard" };

  // Default: if no page param, show landing (signed out) or dashboard (signed in)
  if (pageRaw === "" && agentId) return { key: "agentDetail", agentId };
  return { key: "landing" };
}

function setRouteSearch(page: string, params?: Record<string, string>, mode: "push" | "replace" = "push"): void {
  const url = new URL(window.location.href);

  // Clear old params
  url.searchParams.delete("page");
  url.searchParams.delete("agentId");
  url.searchParams.delete("redirectTo");

  url.searchParams.set("page", page);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "replace") window.history.replaceState({}, "", next);
  else window.history.pushState({}, "", next);

  window.dispatchEvent(new Event("wh:locationchange"));
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const { user, loading, signOut } = useSupabaseAuth();

  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.search),
  );

  // Monkey-patch pushState/replaceState to emit custom event
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

  // Sync route state from URL
  useEffect(() => {
    const onLocationChange = () => setRoute(parseRoute(window.location.search));
    window.addEventListener("wh:locationchange", onLocationChange);
    return () => window.removeEventListener("wh:locationchange", onLocationChange);
  }, []);

  // Auth guard: redirect to login if accessing protected route while signed out
  useEffect(() => {
    if (loading) return;
    if (!user && route.key !== "landing" && route.key !== "auth") {
      const currentPage = new URLSearchParams(window.location.search).get("page") || "";
      const currentPath = currentPage || "dashboard";
      setRouteSearch("login", { redirectTo: currentPath }, "replace");
    }
  }, [user, loading, route.key]);

  // After sign-in, redirect from landing to dashboard
  useEffect(() => {
    if (!loading && user && route.key === "landing") {
      setRouteSearch("dashboard", undefined, "replace");
    }
  }, [user, loading, route.key]);

  const navigateTo = useCallback((page: string, params?: Record<string, string>) => {
    setRouteSearch(page, params);
  }, []);

  const goNav = useCallback((key: "dashboard" | "agents" | "account" | "docs") => {
    if (key === "dashboard") setRouteSearch("dashboard");
    else if (key === "account") setRouteSearch("account");
    else if (key === "docs") setRouteSearch("docs");
    else setRouteSearch("agents");
  }, []);

  if (loading) {
    return (
      <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="muted">Loading...</div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Public routes: landing + auth
  // ---------------------------------------------------------------------------

  if (route.key === "landing" && !user) {
    return (
      <div className="page">
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
                <a className="muted" href="#product">Product</a>
                <a className="muted" href="#how-it-works">How it works</a>
                <a className="muted" href="#pricing">Pricing</a>
              </nav>
              <div style={{ width: 10 }} />
              <button
                className="button"
                type="button"
                onClick={() => setRouteSearch("login")}
              >
                Sign in
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setRouteSearch("signup")}
              >
                Get started
              </button>
            </div>
          </div>
        </header>

        <main className="main">
          <div className="container">
            <LandingPage />
          </div>
        </main>
      </div>
    );
  }

  if (route.key === "auth") {
    return (
      <div className="page">
        <AuthPage
          mode={route.mode}
          redirectTo={route.redirectTo}
          onNavigate={navigateTo}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Protected routes: dashboard shell
  // ---------------------------------------------------------------------------

  const activeNavKey: "dashboard" | "agents" | "account" | "docs" =
    route.key === "dashboard"
      ? "dashboard"
      : route.key === "account"
        ? "account"
        : route.key === "docs"
          ? "docs"
          : "agents";

  const authedNav = [
    { key: "dashboard" as const, label: "Dashboard" },
    { key: "agents" as const, label: "Agents" },
    { key: "account" as const, label: "Account" },
    { key: "docs" as const, label: "Documentation" },
  ];

  return (
    <div className="page">
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
                  <a className="button" href="#agents">Agents list</a>
                </nav>
              ) : (
                <nav className="acp-nav-sections" aria-label="Agent detail sections">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setRouteSearch("agents")}
                    title="Back to agents list"
                  >
                    &larr; Back
                  </button>
                  <a className="button" href="#agent">Selected agent</a>
                  <a className="button" href="#deploy">Deploy</a>
                  <a className="button" href="#invoke">Invoke</a>
                  <a className="button" href="#deployments">Deployments</a>
                  <a className="button" href="#rollback">Rollback</a>
                  <a className="button" href="#telemetry">Telemetry</a>
                </nav>
              )
            ) : activeNavKey === "docs" ? (
              <nav className="acp-nav-sections" aria-label="Documentation sections">
                <a className="button" href="#spec">Spec</a>
                <a className="button" href="#quickstart">Quickstart</a>
                <a className="button" href="#endpoints">Endpoints</a>
              </nav>
            ) : activeNavKey === "account" ? (
              <nav className="acp-nav-sections" aria-label="Account sections">
                <a className="button" href="#identity">Identity</a>
                <a className="button" href="#usage">Tier & usage</a>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {user?.email}
                </span>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    void signOut();
                    setRouteSearch("login", undefined, "replace");
                  }}
                  style={{ fontSize: 12 }}
                >
                  Sign out
                </button>
              </div>
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
                setRouteSearch("agent", { agentId })
              }
            />
          ) : route.key === "agentDetail" ? (
            <AgentsPage
              mode="detail"
              agentId={route.agentId}
              onBackToList={() => setRouteSearch("agents")}
            />
          ) : route.key === "account" ? (
            <AccountPage />
          ) : (
            <DocsPage />
          )}
        </div>
      </div>
    </div>
  );
}
