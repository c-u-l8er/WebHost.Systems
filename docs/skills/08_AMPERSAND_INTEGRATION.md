# 08 — [&] Protocol Integration

> **Purpose:** How WebHost.Systems integrates with the [&] Protocol ecosystem,
> including ampersand.json manifests, MCP sidecar orchestration, agent-to-agent
> skill routing, Delegatic governance, capability provider resolution, and
> hash-linked provenance in telemetry.

---

## Overview

WebHost.Systems is the **hosting layer** for [&] Protocol agents. The platform
extends the base agent deployment model with protocol-aware capabilities:

- **Manifest validation** -- `ampersand.json` alongside `agent.config.json`
- **MCP sidecars** -- Graphonomous, TickTickClock, and other MCP servers
- **A2A routing** -- Agent-to-agent skill invocation
- **Governance** -- Delegatic policy enforcement
- **Provenance** -- Hash-linked telemetry chain

---

## ampersand.json Manifest

Agents that participate in the [&] Protocol include an `ampersand.json` in
their deployment bundle:

```json
{
  "protocol": "ampersand/v1",
  "identity": {
    "name": "research-agent",
    "capabilities": ["web-search", "summarization"],
    "version": "1.0.0"
  },
  "mcp_sidecars": [
    { "name": "graphonomous", "version": ">=0.5.0" },
    { "name": "ticktickclock", "version": ">=0.2.0" }
  ],
  "a2a": {
    "skills_offered": ["web-search", "document-analysis"],
    "skills_consumed": ["code-execution"]
  },
  "governance": {
    "delegatic_policy": "default-sandbox",
    "max_delegation_depth": 3
  }
}
```

### Validation Rules

- [ ] `protocol` field is `ampersand/v1`
- [ ] `identity.name` matches the agent name
- [ ] `capabilities` are from the registered capability set
- [ ] `mcp_sidecars` reference known MCP server packages
- [ ] `governance.max_delegation_depth` is within platform limits

---

## MCP Sidecar Orchestration

When an agent declares `mcp_sidecars`, the platform provisions companion MCP
servers alongside the agent runtime:

### Lifecycle

```
1. Deploy validates ampersand.json sidecar declarations
2. Platform resolves sidecar versions from registry
3. Sidecar processes are started alongside agent runtime
4. Agent communicates with sidecars via MCP protocol (stdio or HTTP)
5. Sidecars share the agent's namespace but not its secrets
```

### Supported Sidecars

| Sidecar | Purpose |
|---------|---------|
| **Graphonomous** | Continual learning engine, knowledge graph |
| **TickTickClock** | Temporal intelligence, scheduling |
| **GeoFleetic** | Spatial intelligence |

### Configuration

Sidecar config is injected via environment variables:

```
GRAPHONOMOUS_MCP_URL=http://localhost:3100
TICKTICKCLOCK_MCP_URL=http://localhost:3101
```

---

## Agent-to-Agent (A2A) Skill Routing

Agents can invoke skills offered by other agents within the same tenant:

```
Agent A (consumer) -> POST /functions/v1/a2a/invoke
  {
    "skill": "code-execution",
    "input": { "prompt": "Run this Python script..." },
    "caller": { "agentId": "<agent-a-id>", "traceId": "tr_xyz" }
  }
```

### Routing Logic

1. Resolve agents offering the requested skill (same user, status `active`)
2. Select best match (priority: explicit preference, then capability score)
3. Invoke target agent via the standard invocation gateway
4. Return result to caller with provenance metadata

### Constraints

- A2A calls count toward both caller and callee usage quotas
- Delegation depth is enforced per `governance.max_delegation_depth`
- Circular delegation is detected and rejected

---

## Delegatic Governance

The [&] Protocol uses Delegatic for governance enforcement:

| Policy | Effect |
|--------|--------|
| `default-sandbox` | Agent can only access declared capabilities |
| `strict-isolation` | No A2A calls, no external network |
| `supervised` | A2A calls require explicit approval |

Governance policies are evaluated at:

- **Deploy time:** Validate manifest against policy constraints
- **Invoke time:** Check delegation depth and capability scope
- **A2A routing:** Enforce caller/callee governance compatibility

---

## Capability Provider Resolution

When an agent declares capabilities it needs but does not implement, the
platform resolves them from the capability registry:

```
Agent declares: skills_consumed: ["code-execution"]
Platform resolves: agent "code-runner-v2" offers "code-execution"
Runtime wiring: inject provider endpoint into agent env
```

Resolution happens at deploy time. The resolved provider mapping is stored in
`deployments.provider_ref` alongside the runtime reference.

---

## Provenance in Telemetry

[&] Protocol agents emit telemetry with hash-linked provenance:

```json
{
  "trace_id": "tr_abc123",
  "parent_trace_id": "tr_parent",
  "provenance": {
    "hash": "sha256:abcdef...",
    "parent_hash": "sha256:012345...",
    "protocol": "ampersand/v1",
    "delegation_depth": 1
  }
}
```

Each telemetry event links to its parent via content hash, creating an
auditable chain of agent interactions.

---

## Checklist

- [ ] `ampersand.json` is validated during deployment
- [ ] MCP sidecars are provisioned from the sidecar registry
- [ ] Sidecar lifecycle is tied to agent deployment lifecycle
- [ ] A2A routing respects governance policies
- [ ] Delegation depth is tracked and enforced
- [ ] Circular delegation is detected and rejected
- [ ] Capability resolution happens at deploy time
- [ ] Telemetry includes hash-linked provenance when [&] Protocol is active
- [ ] A2A invocations count toward both caller and callee usage
