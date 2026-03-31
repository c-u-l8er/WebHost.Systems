# webhost.systems — [&] Protocol Integration Spec (v1)
Version: 1.0
Status: Draft
Audience: Engineering
Last updated: 2026-03-28

> This document extends the v1 spec to make WebHost.Systems the canonical hosting layer for [&] Protocol agents.

---

## 0) Context

WebHost.Systems currently treats agents as opaque code bundles deployed to Cloudflare Workers or AWS AgentCore. To serve as the hosting platform for the [&] Protocol ecosystem, WHS must understand **capability declarations**, **MCP sidecar orchestration**, **agent-to-agent skill routing**, and **governance enforcement**.

This spec adds [&]-aware features as phased extensions to the existing v1 architecture. The current CRUD/deploy/invoke/telemetry foundation remains intact.

---

## 1) Capability Manifests (ampersand.json)

### 1.1 Problem

Agents currently declare only `name`, `description`, `framework`, and `runtimeProvider`. There is no way for the platform to know what capabilities an agent uses (`&memory.graph`, `&time.anomaly`, etc.) or what it provides.

### 1.2 Solution

Support an optional `ampersand.json` manifest alongside the agent code bundle. When present, WHS validates it against the [&] Protocol schema and uses it for:
- Capability-aware deployment (auto-provision required MCP sidecars)
- FleetPrompt registry integration (publish agent capabilities)
- Governance enforcement (Delegatic policy checks)

### 1.3 Schema

The manifest follows `AmpersandBoxDesign/protocol/schema/v0.1.0/ampersand.schema.json`.

Key fields for WHS:
```json
{
  "agent": "my-agent",
  "version": "1.0.0",
  "capabilities": {
    "uses": ["&memory.graph", "&time.anomaly", "&reason.deliberate"],
    "provides": ["&space.fleet.locate"]
  },
  "providers": {
    "&memory.graph": { "provider": "graphonomous", "config": { "db": "auto" } },
    "&time.anomaly": { "provider": "ticktickclock" },
    "&reason.deliberate": { "provider": "auto" }
  },
  "governance": {
    "autonomy": "advise",
    "constraints": { "hard": ["no_network_without_approval"], "soft": [] }
  },
  "mcp_servers": ["graphonomous", "ticktickclock"]
}
```

### 1.4 Data Model Extension

Add to `agents` table:
```
ampersandManifest: optional JSON blob (validated against schema on deploy)
capabilitiesUsed: optional string[] (denormalized from manifest for search/filter)
capabilitiesProvided: optional string[] (denormalized for registry)
```

### 1.5 Validation

On deployment, if `ampersand.json` is present in the bundle:
1. Validate against [&] schema (reuse `@ampersand-protocol/validate` npm package)
2. Extract `capabilities.uses` and `capabilities.provides`
3. Verify all declared providers are available in the deployment environment
4. Store validated manifest in `agents.ampersandManifest`

---

## 2) MCP Sidecar Orchestration

### 2.1 Problem

[&] agents compose capabilities via MCP servers (Graphonomous for `&memory`, TickTickClock for `&time`, etc.). Currently WHS deploys agents in isolation with no MCP server connectivity.

### 2.2 Solution

**Phase 1 — Linked MCP services**: Allow agents to declare MCP server dependencies. WHS provisions and manages these as linked services (similar to linked databases in PaaS platforms).

**Phase 2 — MCP sidecar model**: For Cloudflare Workers, run MCP servers as Durable Object sidecars. For AgentCore, use linked Lambda/container sidecars.

### 2.3 Configuration

In `ampersand.json`:
```json
{
  "mcp_servers": [
    {
      "name": "graphonomous",
      "transport": "streamable_http",
      "config": {
        "db_path": "auto",
        "embedder_backend": "fallback"
      }
    }
  ]
}
```

### 2.4 Data Model Extension

New table: `linkedServices`
```
agentId: Id<"agents">
serviceType: "mcp_server" | "database" | "cache"
serviceName: string
providerRef: string (provider-specific endpoint/identifier)
config: JSON
status: "provisioning" | "active" | "error" | "deprovisioned"
createdAt: number
```

### 2.5 Runtime Provider Interface Extension

Add to RPI (§20):
```typescript
interface RuntimeProviderAdapter {
  // ... existing methods ...

  // Phase 2: MCP sidecar support
  provisionLinkedService?(agentId: string, service: LinkedServiceConfig): Promise<ServiceRef>;
  deprovisionLinkedService?(agentId: string, serviceRef: string): Promise<void>;
  getLinkedServiceEndpoint?(agentId: string, serviceName: string): Promise<string>;
}
```

---

## 3) Agent-to-Agent Skill Routing (A2A)

### 3.1 Problem

Currently only human→agent invocation is supported. [&] agents need to invoke skills on other agents (e.g., a fleet coordinator querying a spatial intelligence agent).

### 3.2 Solution

Add A2A invocation support using the A2A protocol (agent-to-agent, complementary to MCP):

1. **Skill declaration**: Agents declare `a2a_skills` in their manifest
2. **Skill discovery**: WHS maintains an internal skill registry (derived from manifests)
3. **Skill invocation**: Agents can invoke skills on other agents via a WHS-mediated endpoint
4. **Governance**: All A2A calls pass through Delegatic policy checks

### 3.3 API Extension

```
POST /api/v1/a2a/invoke
{
  "caller_agent_id": "agent_abc",
  "skill": "fleet-state-enrichment",
  "input": { ... },
  "session_id": "optional"
}
```

WHS resolves the skill to a target agent, checks governance policies, invokes the target, and returns the result.

### 3.4 Data Model Extension

New table: `skillRegistry`
```
agentId: Id<"agents">
skill: string
capability: string (&space.fleet, etc.)
status: "active" | "inactive"
```

---

## 4) Governance Enforcement (Delegatic Integration)

### 4.1 Problem

WHS currently enforces only tier-based billing limits. [&] agents need governance enforcement: hard/soft constraints, autonomy levels, goal-aware authorization, and audit trails.

### 4.2 Solution

Integrate with Delegatic for governance:

1. **Policy attachment**: Link agents to Delegatic org/policy trees
2. **Pre-invocation check**: Before invoking an agent, check Delegatic policies
3. **Audit forwarding**: Forward invocation telemetry to Delegatic audit trail
4. **Autonomy enforcement**: Respect `observe | advise | act` autonomy levels from manifests

### 4.3 Configuration

In `ampersand.json`:
```json
{
  "governance": {
    "delegatic_org_id": "org_xyz",
    "autonomy": "advise",
    "constraints": {
      "hard": ["no_network_without_approval", "no_filesystem_write"],
      "soft": ["prefer_local_inference"]
    }
  }
}
```

### 4.4 Invocation Flow Change

Updated Flow C (Invoke agent):
1. Client calls `POST /invoke/:agentId`
2. Control plane authenticates/authorizes
3. **NEW**: If agent has governance config, call Delegatic policy check
4. Check plan limits and agent status
5. Route to runtime provider
6. **NEW**: Forward telemetry to Delegatic audit
7. Return response

---

## 5) Provider Registry (Dynamic Resolution)

### 5.1 Problem

Runtime providers (Cloudflare, AgentCore) are hardcoded. [&] agents declare capability providers that should be resolved dynamically (e.g., `"provider": "auto"` should resolve to the best available provider for `&memory.graph`).

### 5.2 Solution

Add a capability provider registry to WHS:

```
Provider: graphonomous → Capabilities: [&memory.graph, &memory.consolidate, &reason.deliberate, &reason.attend]
Provider: ticktickclock → Capabilities: [&time.anomaly, &time.forecast, &time.pattern]
Provider: geofleetic → Capabilities: [&space.fleet, &space.route, &space.geofence]
Provider: bendscript → Capabilities: [&memory.graph (KAG)]
```

When `"provider": "auto"`, WHS resolves to the best available provider based on:
1. Capability match
2. Provider availability in deployment region
3. Cost tier of the user's plan
4. Governance constraints

---

## 6) Provenance and Audit Trail

### 6.1 Problem

Currently invocations have basic `traceId` but no hash-linked provenance chain. For [&] agents, every decision should be traceable back through the capability calls that informed it.

### 6.2 Solution

Extend telemetry events with provenance fields:

```typescript
interface TelemetryEvent {
  // ... existing fields ...

  // [&] provenance extension
  ampersand?: {
    capabilities_invoked: string[];      // ["&memory.graph.recall", "&time.anomaly.detect"]
    routing_decision: "fast" | "deliberate";  // κ routing result
    kappa_value?: number;                // cyclicity score if deliberation was triggered
    goal_id?: string;                    // Graphonomous GoalGraph reference
    provenance_hash?: string;            // hash-linked to parent invocation
    a2a_calls?: {
      target_agent: string;
      skill: string;
      duration_ms: number;
    }[];
  };
}
```

---

## 7) Implementation Phases

### Phase 1 — Manifest Support (lowest lift, highest signal)
- [ ] Accept `ampersand.json` in deployment bundles
- [ ] Validate against [&] schema using `@ampersand-protocol/validate`
- [ ] Store manifest + denormalized capabilities in `agents` table
- [ ] Add capability filter to agent list API
- [ ] Update dashboard to show declared capabilities

### Phase 2 — MCP Linked Services
- [ ] Design linked service provisioning for Cloudflare (Durable Object sidecars)
- [ ] Design linked service provisioning for AgentCore (Lambda sidecars)
- [ ] Implement RPI extensions for linked service lifecycle
- [ ] Auto-provision declared `mcp_servers` on deploy

### Phase 3 — A2A Skill Routing
- [ ] Build internal skill registry from agent manifests
- [ ] Implement `/api/v1/a2a/invoke` endpoint
- [ ] Add governance check gate to A2A calls
- [ ] Dashboard: show skill graph visualization

### Phase 4 — Governance Integration
- [ ] Integrate Delegatic policy check in invocation flow
- [ ] Forward audit events to Delegatic
- [ ] Enforce autonomy levels from manifest
- [ ] Dashboard: show governance status per agent

### Phase 5 — Provider Registry + Provenance
- [ ] Build capability provider registry
- [ ] Implement `"provider": "auto"` resolution
- [ ] Extend telemetry schema with provenance fields
- [ ] Hash-linked invocation chains

---

## 8) Relationship to Existing Spec

This document extends (does not replace) the following v1 spec sections:

| Existing Section | Extension |
|---|---|
| `00_MASTER_SPEC.md` §5.1 Agent management | Add `ampersandManifest`, `capabilitiesUsed`, `capabilitiesProvided` fields |
| `10_API_CONTRACTS.md` | Add `/api/v1/a2a/invoke`, capability filter on agent list |
| `20_RUNTIME_PROVIDER_INTERFACE.md` | Add linked service methods to RPI |
| `30_DATA_MODEL_SUPABASE.md` | Add `linkedServices`, `skillRegistry` tables; extend `agents` |
| `40_SECURITY_SECRETS_COMPLIANCE.md` | Governance constraints as security policy |
| `50_OBSERVABILITY_BILLING_LIMITS.md` | Provenance fields in telemetry; capability-aware metering |
| `60_TESTING_ACCEPTANCE.md` | Acceptance tests for manifest validation, A2A routing, governance checks |
