import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import {
  ControlPlaneApiError,
  ControlPlaneClient,
  type CurrentUsageResponse,
} from "../lib/controlPlaneClient";

type AsyncStatus = "idle" | "loading" | "success" | "error";

function summarizeError(err: unknown): string {
  if (err instanceof ControlPlaneApiError) {
    const rid = err.requestId ? ` requestId=${err.requestId}` : "";
    const status = ` status=${err.status}`;
    const retryable =
      typeof err.retryable === "boolean" ? ` retryable=${err.retryable}` : "";

    let details = "";
    if (err.details !== undefined) {
      try {
        details = ` details=${JSON.stringify(err.details)}`;
      } catch {
        details = " details=[unserializable]";
      }
    }

    return `${err.code}: ${err.message} (${status}${rid}${retryable})${details}`;
  }

  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  try {
    return new Intl.NumberFormat().format(n);
  } catch {
    return String(n);
  }
}

function formatUsd(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 4,
    }).format(n);
  } catch {
    return String(n);
  }
}

export default function AccountPage(): React.ReactElement {
  const { user } = useUser();
  const { getToken } = useAuth();

  const controlPlaneUrl = useMemo(() => {
    const raw = import.meta.env.VITE_CONTROL_PLANE_URL;
    return raw ? raw.replace(/\/+$/, "") : "";
  }, []);

  const clerkJwtTemplate = useMemo(() => {
    // Intentionally typed via `any` to avoid requiring a vite-env.d.ts change in this edit.
    const raw = (import.meta as any).env?.VITE_CLERK_JWT_TEMPLATE as
      | string
      | undefined;
    const trimmed = raw?.trim();
    return trimmed ? trimmed : "convex";
  }, []);

  const client = useMemo(() => {
    if (!controlPlaneUrl) return null;

    return new ControlPlaneClient({
      baseUrl: controlPlaneUrl,
      getToken: async () => {
        try {
          if (clerkJwtTemplate === "default") {
            return await getToken();
          }
          return await getToken({ template: clerkJwtTemplate });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Failed to fetch Clerk JWT (template "${clerkJwtTemplate}"). ` +
              `If you see a 404 to /tokens/${clerkJwtTemplate}, create a Clerk JWT template named "${clerkJwtTemplate}" ` +
              `with audience/application ID "convex", or set VITE_CLERK_JWT_TEMPLATE to an existing template name. ` +
              `Underlying error: ${detail}`,
          );
        }
      },
    });
  }, [controlPlaneUrl, getToken, clerkJwtTemplate]);

  const [usageStatus, setUsageStatus] = useState<AsyncStatus>("idle");
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usage, setUsage] = useState<CurrentUsageResponse | null>(null);

  const refreshUsage = useCallback(async () => {
    if (!client) return;

    setUsageStatus("loading");
    setUsageError(null);

    try {
      const u = await client.getCurrentUsage();
      setUsage(u);
      setUsageStatus("success");
    } catch (err) {
      setUsageStatus("error");
      setUsageError(summarizeError(err));
    }
  }, [client]);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    "—";

  const tier = usage?.tier ?? "—";
  const periodKey = usage?.periodKey ?? "—";
  const u = usage?.usage;

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="row">
          <div className="brand">
            <div className="brand-title">Account</div>
            <div className="brand-subtitle">
              Identity, tier, and current period usage
            </div>
          </div>

          <div className="spacer" />

          <span className="badge">
            <span className="muted">control plane</span>{" "}
            <code>{controlPlaneUrl || "(set VITE_CONTROL_PLANE_URL)"}</code>
          </span>

          <button
            className="button"
            onClick={() => void refreshUsage()}
            disabled={!client || usageStatus === "loading"}
          >
            {usageStatus === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="panel-body">
        {!controlPlaneUrl ? (
          <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
            <div className="muted">
              Set <code>VITE_CONTROL_PLANE_URL</code> in <code>.env.local</code>{" "}
              to your Convex HTTP base URL (e.g.{" "}
              <code>https://&lt;deployment&gt;.convex.site</code>).
            </div>
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div className="panel" id="identity" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <strong>Identity (Clerk)</strong>
              <div className="spacer" />
              <span className="badge">
                <span className="muted">auth</span> clerk
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: 8,
              }}
            >
              <div className="muted">Name</div>
              <div>{user?.fullName || user?.username || "—"}</div>

              <div className="muted">Email</div>
              <div>{email}</div>

              <div className="muted">Clerk userId</div>
              <div>
                <code>{user?.id || "—"}</code>
              </div>
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Billing settings and org/team features are out of scope for v1.
            </div>
          </div>

          <div className="panel" id="usage" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <strong>Tier & usage (control plane)</strong>
              <div className="spacer" />
              <span className="badge">
                <span className="muted">period</span> {periodKey}
              </span>
              <span className="badge">
                <span className="muted">tier</span> {tier}
              </span>
            </div>

            {usageError ? (
              <div
                className="badge"
                style={{
                  borderColor: "rgba(255, 107, 107, 0.6)",
                  background: "rgba(255, 107, 107, 0.08)",
                  marginBottom: 10,
                }}
              >
                <span style={{ color: "var(--danger)" }}>Usage error:</span>{" "}
                <span>{usageError}</span>
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr",
                gap: 8,
              }}
            >
              <div className="muted">Requests</div>
              <div>{formatNumber(u?.requests)}</div>

              <div className="muted">LLM tokens</div>
              <div>{formatNumber(u?.llmTokens)}</div>

              <div className="muted">Compute (ms)</div>
              <div>{formatNumber(u?.computeMs)}</div>

              <div className="muted">Tool calls</div>
              <div>{formatNumber(u?.toolCalls)}</div>

              <div className="muted">Estimated cost</div>
              <div>{formatUsd(u?.costUsdEstimated)}</div>
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Tier upgrades + billing webhooks are not implemented yet; this view
              is driven by the control plane entitlements mapping.
            </div>
          </div>
        </div>

        <div style={{ height: 12 }} />

        <div className="panel" style={{ padding: 12 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <strong>Next: Billing</strong>
            <div className="spacer" />
            <span className="badge">
              <span className="muted">status</span> coming soon
            </span>
          </div>

          <div className="muted">
            When billing is wired up (checkout + webhook-driven entitlements),
            this page will include:
            <ul>
              <li>subscription status and renewal</li>
              <li>upgrade/downgrade</li>
              <li>invoice history</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
