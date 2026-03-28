# 06 — Billing and Limits

> **Purpose:** Subscription tiers, plan enforcement at invoke and deploy time,
> checkout and webhook flow, usage aggregation, retention policies, and
> overage handling.

---

## Subscription Tiers

| Feature | Free | Starter | Pro | Enterprise |
|---------|------|---------|-----|------------|
| Requests / month | 1,000 | 10,000 | 100,000 | Custom |
| Token budget / month | 100K | 1M | 10M | Custom |
| Compute budget (ms) / month | 60,000 | 600,000 | 6,000,000 | Custom |
| Log retention (days) | 3 | 14 | 30 | 90+ |
| Runtime: Cloudflare | Yes | Yes | Yes | Yes |
| Runtime: AgentCore | No | No | Yes | Yes |
| Max agents | 3 | 10 | 50 | Unlimited |

---

## Enforcement Points

### At Invoke Time

The invocation gateway checks `billing_usage` for the current period before
routing to the provider:

```typescript
const usage = await getBillingUsage(userId, currentPeriod());
const limits = TIER_LIMITS[user.subscriptionTier];

if (usage.totalRequests >= limits.maxRequests) {
  throw new LimitExceededError("Monthly request limit reached.");
}
if (usage.totalTokens >= limits.maxTokens) {
  throw new LimitExceededError("Monthly token limit reached.");
}
```

If any limit is exceeded, the gateway returns `LIMIT_EXCEEDED` (HTTP 429).

### At Deploy Time

The deploy Edge Function enforces:

- **Runtime gating:** Free and Starter tiers cannot deploy to AgentCore.
- **Agent count:** Deployment is rejected if the user has reached their tier's
  max agent count.

```typescript
if (agent.runtimeProvider === "agentcore" && !AGENTCORE_TIERS.includes(user.tier)) {
  throw new UnauthorizedError("AgentCore requires Pro or Enterprise tier.");
}
```

---

## Checkout Flow

WebHost.Systems uses LemonSqueezy (or equivalent) for subscription billing:

```
1. User clicks "Upgrade" in dashboard
2. POST /functions/v1/billing/checkout { tier: "pro" }
3. Edge Function creates LemonSqueezy checkout session
4. Returns checkout URL -> user completes payment
5. LemonSqueezy sends webhook to /functions/v1/billing/webhook
6. Edge Function verifies webhook signature
7. UPDATE users SET subscription_tier = 'pro' WHERE id = user_id
```

---

## Webhook Events

| Event | Action |
|-------|--------|
| `subscription_created` | Set `subscription_tier` to new tier |
| `subscription_updated` | Update tier (upgrade/downgrade) |
| `subscription_cancelled` | Downgrade to `free` at period end |
| `subscription_payment_failed` | Flag account; optionally restrict after grace |

The webhook Edge Function:

1. Verifies the `X-Signature` header against the webhook secret
2. Extracts user identity from webhook payload metadata
3. Updates `users.subscription_tier` accordingly

---

## Usage Aggregation

Raw `metrics_events` are aggregated into `billing_usage` by `pg_cron`:

```sql
-- billing_usage row per user per month
{
  user_id, period_key,
  total_requests, total_tokens, total_compute_ms,
  total_cost_usd_estimated,
  per_runtime_breakdown,  -- JSONB: { cloudflare: {...}, agentcore: {...} }
  paid, invoice_id
}
```

The `period_key` format is `YYYY-MM`. Aggregation is incremental -- new events
are summed into the existing row, not recomputed from scratch.

---

## Retention Policies

Log and metrics retention is tier-dependent:

| Tier | `metrics_events` retention |
|------|---------------------------|
| Free | 3 days |
| Starter | 14 days |
| Pro | 30 days |
| Enterprise | 90+ days |

A `pg_cron` job periodically deletes old `metrics_events` rows:

```sql
DELETE FROM metrics_events
WHERE timestamp_ms < extract(epoch from (now() - retention_interval(user_id))) * 1000;
```

`billing_usage` aggregated rows are retained indefinitely.

---

## Overage Handling (Post-MVP)

MVP uses **hard stop** -- invocations are rejected when limits are exceeded.

Post-MVP options:

1. **Pay-as-you-go:** Allow overages at a per-unit rate, billed at period end.
2. **Soft limits:** Warn users at 80% and 100%, hard stop at 120%.
3. **Reconciled billing:** Reconcile estimated costs with provider billing exports.

---

## Checklist

- [ ] Tier limits are defined and stored in a configuration table or constants
- [ ] Invocation gateway checks all three limit types (requests, tokens, compute)
- [ ] Deploy enforces runtime gating and agent count limits
- [ ] Checkout creates a valid billing provider session
- [ ] Webhook verifies signature before processing
- [ ] `subscription_tier` is updated transactionally on webhook events
- [ ] Aggregation job runs on schedule and handles partial failures
- [ ] Retention cleanup job respects per-tier retention windows
- [ ] Downgrade on cancellation is deferred to period end
