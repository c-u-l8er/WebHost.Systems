import React, { useCallback, useEffect, useState } from "react";
import { useSupabaseAuth } from "../lib/SupabaseAuthProvider";
import { useWorkspace } from "../lib/WorkspaceProvider";
import { ApiError, getBillingUsage, type BillingUsage } from "../lib/supabaseApi";

type AsyncStatus = "idle" | "loading" | "success" | "error";

function summarizeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code}: ${err.message} (status=${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return "\u2014";
  try {
    return new Intl.NumberFormat().format(n);
  } catch {
    return String(n);
  }
}

function formatUsd(n: number | undefined | null): string {
  if (n === undefined || n === null) return "\u2014";
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
  const { user } = useSupabaseAuth();
  const { workspace } = useWorkspace();

  const [usageStatus, setUsageStatus] = useState<AsyncStatus>("idle");
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);

  const refreshUsage = useCallback(async () => {
    if (!workspace) return;

    setUsageStatus("loading");
    setUsageError(null);

    try {
      const u = await getBillingUsage(workspace.id);
      setUsage(u);
      setUsageStatus("success");
    } catch (err) {
      setUsageStatus("error");
      setUsageError(summarizeError(err));
    }
  }, [workspace]);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  const email = user?.email ?? "\u2014";
  const tier = workspace?.plan ?? "\u2014";
  const periodKey = usage?.period_key ?? "\u2014";
  const t = usage?.totals;

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
            <span className="muted">workspace</span>{" "}
            <code>{workspace?.name ?? "(none)"}</code>
          </span>

          <button
            className="button"
            onClick={() => void refreshUsage()}
            disabled={!workspace || usageStatus === "loading"}
          >
            {usageStatus === "loading" ? "Refreshing\u2026" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="panel-body">
        {!workspace ? (
          <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
            <div className="muted">
              No workspace found. One will be auto-created on next page load.
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
              <strong>Identity (Supabase Auth)</strong>
              <div className="spacer" />
              <span className="badge">
                <span className="muted">auth</span> supabase
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: 8,
              }}
            >
              <div className="muted">Email</div>
              <div>{email}</div>

              <div className="muted">User ID</div>
              <div>
                <code>{user?.id ?? "\u2014"}</code>
              </div>

              <div className="muted">Workspace</div>
              <div>
                <code>{workspace?.slug ?? "\u2014"}</code>
              </div>
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Billing settings and org/team features are out of scope for v1.
            </div>
          </div>

          <div className="panel" id="usage" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <strong>Tier & usage</strong>
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
              <div>{formatNumber(t?.requests)}</div>

              <div className="muted">LLM tokens</div>
              <div>{formatNumber(t?.tokens)}</div>

              <div className="muted">Compute (ms)</div>
              <div>{formatNumber(t?.compute_ms)}</div>

              <div className="muted">Estimated cost</div>
              <div>{formatUsd(t?.cost_usd_estimated)}</div>
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Tier upgrades + billing webhooks are not implemented yet; this view
              is driven by the billing_usage aggregation.
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
