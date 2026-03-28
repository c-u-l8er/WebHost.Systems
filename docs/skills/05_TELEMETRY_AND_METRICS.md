# 05 — Telemetry and Metrics

> **Purpose:** How telemetry events flow from the data plane to the control
> plane, the metrics schema, authentication (HMAC/signed JWT), ingestion,
> aggregation into billing_usage, and time-series queries.

---

## Telemetry Flow

```
Data Plane (Worker/DO or AgentCore)
  |
  | POST /functions/v1/metrics/report (HMAC-signed)
  |
  v
Edge Function (telemetry ingestion)
  |
  | Verify HMAC -> INSERT into metrics_events
  |
  v
pg_cron (periodic aggregation)
  |
  | SUM/GROUP BY user_id + period_key
  |
  v
billing_usage table
  |
  v
Dashboard / Limit Checks
```

---

## Metrics Event Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Auto-generated |
| `user_id` | UUID | Event owner |
| `agent_id` | UUID | Agent that was invoked |
| `deployment_id` | UUID | Specific deployment version |
| `runtime_provider` | enum | `cloudflare` or `agentcore` |
| `timestamp_ms` | bigint | Unix ms when invocation occurred |
| `requests` | int | Always 1 per event |
| `llm_tokens` | int | Token count (actual or estimated) |
| `compute_ms` | int | Wall-clock execution time |
| `errors` | int | 0 or 1 |
| `error_class` | string? | Error category if errors > 0 |
| `provider_details` | JSONB | Provider-specific metadata |
| `cost_usd_estimated` | numeric | Estimated cost in USD |
| `trace_id` | string | Correlation ID for tracing |

---

## Telemetry Authentication

Unauthenticated telemetry events are **rejected**. Two authentication methods
are supported:

### Option A: HMAC Signature

A per-deployment HMAC key is generated at deploy time, stored in Supabase Vault,
and injected into the runtime as an environment variable.

```
X-Telemetry-Signature: sha256=<hmac-hex>
X-Telemetry-Timestamp: <unix-ms>
```

The ingestion endpoint verifies:

1. Timestamp is within 5-minute window (anti-replay)
2. HMAC matches `HMAC-SHA256(key, timestamp + body)`

### Option B: Signed JWT

The control plane mints a short-lived JWT at deploy time, embedded in the
runtime config. The ingestion endpoint validates the JWT signature and claims.

---

## Ingestion Endpoint

```
POST /functions/v1/metrics/report
Content-Type: application/json
X-Telemetry-Signature: sha256=<hmac>
X-Telemetry-Timestamp: 1706832000000

{
  "agent_id": "<uuid>",
  "deployment_id": "<uuid>",
  "user_id": "<uuid>",
  "runtime_provider": "cloudflare",
  "timestamp_ms": 1706832000000,
  "requests": 1,
  "llm_tokens": 150,
  "compute_ms": 340,
  "errors": 0,
  "cost_usd_estimated": 0.0023,
  "trace_id": "tr_abc123"
}
```

The Edge Function validates the signature, then inserts into `metrics_events`.
Attribution fields (`agent_id`, `deployment_id`, `user_id`) are verified against
the deployment record to prevent spoofing.

---

## Aggregation via pg_cron

A scheduled PostgreSQL job runs periodically (e.g., every 5 minutes) to
aggregate raw events into `billing_usage`:

```sql
INSERT INTO billing_usage (user_id, period_key,
  total_requests, total_tokens, total_compute_ms, total_cost_usd_estimated)
SELECT
  user_id,
  to_char(to_timestamp(timestamp_ms / 1000), 'YYYY-MM') AS period_key,
  SUM(requests),
  SUM(llm_tokens),
  SUM(compute_ms),
  SUM(cost_usd_estimated)
FROM metrics_events
WHERE timestamp_ms > last_aggregated_ms()
GROUP BY user_id, period_key
ON CONFLICT (user_id, period_key) DO UPDATE SET
  total_requests = billing_usage.total_requests + EXCLUDED.total_requests,
  total_tokens = billing_usage.total_tokens + EXCLUDED.total_tokens,
  total_compute_ms = billing_usage.total_compute_ms + EXCLUDED.total_compute_ms,
  total_cost_usd_estimated = billing_usage.total_cost_usd_estimated + EXCLUDED.total_cost_usd_estimated,
  updated_at = now();
```

---

## Time-Series Queries

The dashboard queries `metrics_events` for time-series visualization:

```sql
SELECT
  date_trunc('hour', to_timestamp(timestamp_ms / 1000)) AS bucket,
  SUM(requests) AS requests,
  SUM(llm_tokens) AS tokens,
  SUM(compute_ms) AS compute_ms,
  SUM(errors) AS errors
FROM metrics_events
WHERE agent_id = $1
  AND timestamp_ms BETWEEN $2 AND $3
GROUP BY bucket
ORDER BY bucket;
```

Supported windows: 1h, 6h, 24h, 7d, 30d.

---

## Checklist

- [ ] Every invocation emits exactly one telemetry event
- [ ] Telemetry endpoint rejects unauthenticated events
- [ ] HMAC key is generated per deployment and stored in Vault
- [ ] Timestamp anti-replay window is enforced (5 minutes)
- [ ] Attribution fields are verified against deployment records
- [ ] pg_cron aggregation runs on schedule
- [ ] billing_usage is updated incrementally (not full recompute)
- [ ] Time-series queries use indexed columns (`agent_id`, `timestamp_ms`)
- [ ] `cost_usd_estimated` uses provider-specific calculators
