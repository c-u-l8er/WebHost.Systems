# webhost.systems - Technical Specification & Implementation Guide

**Version:** 2.0 (UPDATED)  
**Date:** January 21, 2026  
**Update:** Added AWS Bedrock AgentCore & Convex Agents evaluation  
**Status:** MVP Planning Phase

---

## Executive Summary

**webhost.systems** is an **agent-native cloud hosting platform** - the first hosting infrastructure purpose-built for AI agents rather than traditional web applications. While existing platforms (Vercel, Railway, Heroku) optimize for web workloads, webhost.systems optimizes for **autonomous agent workloads**: long-running tasks, state management, event-driven execution, and resource allocation patterns unique to AI agents.

**Market Opportunity:**
- **$527B cloud hosting market** × **5% agent-specific workloads** = **$26B TAM by 2030**
- Comparable: Railway ($20M raise, $300M+ valuation) but for agents
- Exit potential: $15M-$40M by 2030 if executed

**Core Thesis:** AI agents need different infrastructure than web apps. Traditional hosting is optimized for request/response patterns, not agent patterns (reasoning, tool use, persistent state, async workflows). We build the hosting layer agents actually need.

---

## 1. Product Vision & Positioning

### 1.1 What We Are

**"The Agent Hosting Platform"** - A developer platform that makes deploying and scaling AI agents as easy as `git push`.

**Core Value Props:**
1. **Agent-Native Infrastructure:** Optimized for agent workloads (not web apps retrofitted for agents)
2. **Zero DevOps:** Deploy agents without Kubernetes, Docker, or infrastructure knowledge
3. **Instant Scaling:** Handle 1 agent or 10,000 agents with zero config changes
4. **Built-in Agent Primitives:** State management, scheduling, memory, tool execution included
5. **Transparent Pricing:** Pay for what you use - no surprise bills
6. **Multi-Runtime Support:** Choose between edge (fast) or cloud (powerful) runtimes

### 1.2 What We Are NOT

❌ **Not** a general-purpose PaaS (Heroku, Railway)  
❌ **Not** an agent framework (LangGraph, CrewAI) - we HOST agents built with those  
❌ **Not** an LLM provider - we integrate with OpenAI, Anthropic, etc.  
❌ **Not** infrastructure-as-code - we're higher-level abstraction

### 1.3 Target Customer Segments

**Primary (MVP):**
- **Solo AI Developers:** Building agents for personal projects/MVPs
- **AI Startups:** Need to deploy agents without hiring DevOps
- **Indie Hackers:** Monetizing agent-powered SaaS

**Secondary (Post-MVP):**
- **SMB Software Companies:** Adding AI agents to existing products
- **Enterprise Teams:** Need compliance, security, long-running agents

---

## 2. Technical Architecture (UPDATED)

### 2.1 Multi-Runtime Strategy

After comprehensive evaluation including **AWS Bedrock AgentCore** (GA Oct 2025) and **Convex Agents** (GA May 2025), we're adopting a **multi-runtime architecture**:

**Tier 1: Standard Runtime (Default - FREE tier)**
- Cloudflare Workers (global edge, 310+ cities)
- Best for: 90% of agents, low-latency, cost-sensitive users
- Limits: 128MB RAM, ~10min max runtime

**Tier 2: Extended Runtime (Paid - Enterprise)**
- AWS Bedrock AgentCore (4 regions, MicroVM isolation)
- Best for: Long-running (up to 8 hours), enterprise security, compliance
- Features: Built-in browser, code interpreter, memory, observability

**Tier 3: Dashboard Backend**
- Convex Agents (for platform features)
- Use for: Support chatbot, admin tools, onboarding assistants
- Not customer-facing agent hosting

### 2.2 Tech Stack (UPDATED)

```
┌─────────────────────────────────────────────────┐
│                   FRONTEND                      │
│  React 18 + Vite + TypeScript                  │
│  TailwindCSS + Shadcn/ui                       │
│  Deployed on: Cloudflare Pages (free)          │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│              AUTHENTICATION                      │
│           Clerk (Auth + User Mgmt)              │
│  • 10K MAU free tier                            │
│  • Org management                               │
│  • Seamless Convex integration                  │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│           BACKEND/DATABASE                       │
│          Convex (Reactive Backend)              │
│  • Real-time database (TypeScript queries)      │
│  • Convex Agent Component (dashboard logic)     │
│  • Built-in RAG (vector/text search)            │
│  • Serverless functions                          │
│  • File storage                                  │
│  • Workflow integration                         │
└─────────────────┬───────────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │                           │
    ▼                           ▼
┌───────────────────┐  ┌───────────────────┐
│ STANDARD RUNTIME  │  │ ENTERPRISE RUNTIME│
│  (Tier 1 - FREE)  │  │  (Tier 2 - PAID)  │
│                   │  │                   │
│ Cloudflare:       │  │ AWS AgentCore:    │
│ • Workers         │  │ • Runtime (8hrs)  │
│ • Durable Objects │  │ • Memory (epis.)  │
│ • Workers AI      │  │ • Gateway (MCP)   │
│ • Workflows       │  │ • Identity (IAM)  │
│ • MCP support     │  │ • Browser tool    │
│                   │  │ • Code Interp.    │
│                   │  │ • Observability   │
└───────────────────┘  └───────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│           AGENT LOGIC LAYER                     │
│          Vercel AI SDK v6                       │
│  • Provider abstraction (any LLM)               │
│  • Best-in-class tool calling                   │
│  • Type-safe structured output                  │
│  • Agent abstraction (reusable)                 │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│              PAYMENTS/BILLING                    │
│           Lemon Squeezy (MoR)                   │
│  • Handles all global tax compliance            │
│  • Subscription management                       │
│  • Usage-based billing                          │
└─────────────────────────────────────────────────┘
```

### 2.3 Why This Multi-Runtime Approach?

**Cloudflare Workers (Standard Runtime):**
- ✅ **Global edge** - 310+ cities, <50ms latency worldwide
- ✅ **Best economics** - 50% cheaper than alternatives at scale
- ✅ **Free tier** - 100K requests/day
- ✅ **Durable Objects** - Built-in state management
- ✅ **Workers AI** - On-platform LLMs (cheap inference)
- ✅ **MCP native** - Model Context Protocol support
- ✅ **No vendor lock-in** - Can migrate to other platforms
- ❌ **Limits:** 128MB RAM, ~10min runtimes

**AWS Bedrock AgentCore (Enterprise Runtime):**
- ✅ **Longest runtimes** - Up to 8 hours (vs 10 min)
- ✅ **MicroVM isolation** - Enterprise security
- ✅ **7 integrated services** - Memory, Identity, Gateway, Browser, Code Interpreter, Observability
- ✅ **Framework agnostic** - Works with LangGraph, CrewAI, Strands, custom
- ✅ **Already GA** - Production-ready since Oct 2025
- ✅ **Enterprise features** - Compliance, audit logs, IAM
- ❌ **AWS lock-in** - Harder to migrate
- ❌ **Higher cost** - ~2x Cloudflare
- ❌ **Python SDK only** - No TypeScript (yet)

**Convex Agents (Platform Features):**
- ✅ **Already in stack** - No new platform
- ✅ **Reactive real-time** - Instant UI updates
- ✅ **TypeScript-native** - Best DX
- ✅ **Built-in RAG** - Hybrid vector/text search
- ✅ **Perfect for:**
  - Dashboard support chatbot ("Deploy agent for me")
  - Admin automation ("Analyze usage patterns")
  - User onboarding assistant
- ❌ **NOT for customer agents** - 60s timeout, not edge-deployed

**Vercel AI SDK v6:**
- ✅ **Provider abstraction** - Switch LLMs with one line
- ✅ **Best tool calling** - Industry-leading API
- ✅ **Type-safe** - Zod schemas for structured output
- ✅ **Agent abstraction** - Define once, use anywhere
- ✅ **No lock-in** - Works on Cloudflare, AgentCore, anywhere

### 2.4 Data Flow

```
User deploys agent via dashboard
    ↓
Convex creates agent record
    ↓
User selects runtime:
    Standard (Cloudflare) or Enterprise (AgentCore)
    ↓
Platform deploys to selected runtime
    ↓
Agent goes live at endpoint
    ↓
Metrics reported back to Convex
    ↓
Usage aggregated for billing (Lemon Squeezy)
```

---

## 3. Database Schema (Convex)

### 3.1 Core Tables

**users**
```typescript
{
  _id: Id<"users">,
  clerkId: string,
  email: string,
  name: string,
  subscriptionTier: "free" | "starter" | "pro" | "enterprise",
  defaultRuntime: "cloudflare" | "agentcore",
  createdAt: number,
}
```
*Index:* `by_clerk_id`

**agents**
```typescript
{
  _id: Id<"agents">,
  userId: Id<"users">,
  name: string,
  description: string,
  framework: "cloudflare-agents" | "langGraph" | "crewai" | "custom",
  runtime: "cloudflare" | "agentcore",  // NEW
  
  // Runtime-specific fields
  cloudflare?: {
    workerUrl: string,
    durableObjectId: string,
  },
  agentcore?: {
    runtimeId: string,
    region: string,
    vCpu: number,
    memoryMb: number,
  },
  
  status: "deploying" | "active" | "paused" | "error",
  envVars: Record<string, string>,
  createdAt: number,
  lastDeployedAt: number,
}
```
*Index:* `by_user`, `by_runtime`

**deployments**
```typescript
{
  _id: Id<"deployments">,
  agentId: Id<"agents">,
  version: string,
  runtime: "cloudflare" | "agentcore",
  commitHash: string,
  status: "deploying" | "live" | "failed" | "rolled_back",
  logs: string[],
  deployedAt: number,
  deployedBy: Id<"users">,
}
```
*Index:* `by_agent`, `by_agent_and_time`

**metrics** (hourly aggregation)
```typescript
{
  _id: Id<"metrics">,
  agentId: Id<"agents">,
  runtime: "cloudflare" | "agentcore",
  timestamp: number,
  
  // Common metrics
  requests: number,
  llmTokens: number,
  computeMs: number,
  errors: number,
  
  // Runtime-specific
  cloudflare?: {
    durableObjectOps: number,
    workersAICalls: number,
  },
  agentcore?: {
    sessionDurationMs: number,
    toolInvocations: number,
    browserInteractions: number,
  },
  
  costUsd: number,
}
```
*Index:* `by_agent_and_time`

**usage** (billing period)
```typescript
{
  _id: Id<"usage">,
  userId: Id<"users">,
  period: string, // "2026-01"
  
  // Aggregated across all runtimes
  totalRequests: number,
  totalTokens: number,
  totalComputeMs: number,
  
  // Per-runtime breakdown
  cloudflare: {
    requests: number,
    tokens: number,
    costUsd: number,
  },
  agentcore: {
    requests: number,
    tokens: number,
    costUsd: number,
  },
  
  totalCostUsd: number,
  paid: boolean,
  lemonsqueezyInvoiceId?: string,
}
```
*Index:* `by_user_and_period`

---

## 4. Pricing Strategy (UPDATED)

### 4.1 Subscription Tiers

**Free Tier:**
- 1 agent (Cloudflare runtime only)
- 10K requests/month
- 1GB storage
- Community support
- **Price:** $0

**Starter Tier:**
- 5 agents (Cloudflare runtime)
- 100K requests/month
- 10GB storage
- Email support
- **Price:** $29/month

**Pro Tier:**
- Unlimited agents (Cloudflare runtime)
- 1M requests/month
- 100GB storage
- Priority support
- **Optional:** AgentCore runtime (+$50/agent/month)
- **Price:** $99/month

**Enterprise Tier:**
- Everything in Pro
- AgentCore runtime included (up to 10 agents)
- Dedicated support
- SLA guarantees
- Custom contracts
- **Price:** Custom (starts at $500/month)

### 4.2 Runtime Cost Comparison

For 1M agent requests/month:

**Cloudflare Runtime:**
```
Workers: $0.50
Workers AI: $110 (10M tokens @ $0.011/1K)
Durable Objects: $10
Total: ~$121/month
```

**AgentCore Runtime:**
```
Runtime: $200 (consumption-based)
Memory: $25
Gateway: $5
Total: ~$230/month (2x Cloudflare)
```

**Strategy:** Default to Cloudflare for economics, offer AgentCore as premium upgrade.

---

## 5. Core Features (MVP)

### 5.1 Agent Deployment

**Multi-Runtime Support:**
```typescript
// User deploys agent
const deployment = await deployAgent({
  name: "customer-support-bot",
  framework: "langGraph",
  runtime: "cloudflare", // or "agentcore"
  githubUrl: "https://github.com/user/agent",
  envVars: {
    OPENAI_API_KEY: "sk-...",
  },
});

// Platform routes to appropriate runtime
if (runtime === "cloudflare") {
  await deployToCloudflareWorkers(deployment);
} else {
  await deployToAgentCore(deployment);
}
```

**Auto-detect Framework:**
- Read `package.json` / `requirements.txt`
- Detect: Cloudflare Agents, LangGraph, CrewAI, Strands, custom
- Configure appropriate runtime environment

**One-Click Deploy:**
- Connect GitHub repo
- Select branch/tag
- Click "Deploy"
- Get instant live URL

### 5.2 Dashboard (with Convex Agents)

**Real-Time Metrics:**
- Requests/min, tokens/hour, response time, errors
- Per-agent breakdown
- Cross-runtime comparison

**Agent Management:**
- Start/stop/restart agents
- Rollback deployments
- Switch runtimes (Cloudflare ↔ AgentCore)
- Environment variable management

**Live Log Streaming:**
- Real-time logs from both runtimes
- Unified interface (hide runtime complexity)

**Built-in Dashboard Assistant** (Convex Agent):
```typescript
const dashboardAgent = new Agent(components.agent, {
  name: "Dashboard Assistant",
  chat: openai.chat("gpt-4o-mini"),
  instructions: "Help users manage their agents on webhost.systems",
  tools: {
    deployAgent: deployAgentTool,
    checkUsage: checkUsageTool,
    analyzePerformance: analyzePerformanceTool,
    suggestOptimizations: suggestOptimizationsTool,
  },
});

// User asks: "Why is my agent slow?"
// Assistant analyzes metrics, suggests switching to AgentCore for more resources
```

### 5.3 Built-in Agent Primitives

**State Management:**
- **Cloudflare:** Durable Objects (automatic)
- **AgentCore:** AgentCore Memory (episodic + semantic)
- **API:** Unified interface, runtime-agnostic

**Scheduling:**
- Cron jobs for both runtimes
- Timezone support
- Webhook triggers

**Memory/RAG:**
- **Cloudflare:** Convex vector search
- **AgentCore:** AgentCore Memory (built-in)
- Hybrid text + vector search

**Tool Execution:**
- **Cloudflare:** MCP support
- **AgentCore:** AgentCore Gateway (native)
- Pre-built tools: web search, calculator, etc.

### 5.4 Observability

**Unified Dashboard:**
- Works across both runtimes
- OpenTelemetry-compatible
- Custom metrics

**Request Tracing:**
- Full request lifecycle
- Tool invocations
- LLM calls
- Response times

**Error Tracking:**
- Stack traces
- Automatic error grouping
- Alerts & notifications

---

## 6. Implementation Roadmap (12 Weeks)

### Phase 1: Foundation (Weeks 1-2)

**Week 1: Core Setup**
- Day 1-2: Vite + React + TypeScript init
- Day 3-4: Clerk authentication
- Day 5-7: Convex backend setup

**Week 2: Cloudflare Integration**
- Day 8-10: Cloudflare Workers deployment pipeline
- Day 11-12: Durable Objects state management
- Day 13-14: Workers AI integration

### Phase 2: Multi-Runtime (Weeks 3-5)

**Week 3: AgentCore Integration**
- Day 15-16: AWS account, AgentCore SDK setup
- Day 17-18: Deploy test agent to AgentCore
- Day 19-21: Build runtime abstraction layer

**Week 4: Deployment Pipeline**
- Day 22-24: GitHub OAuth, auto-deploy
- Day 25-26: Framework detection
- Day 27-28: Build + deploy automation

**Week 5: Dashboard UI**
- Day 29-31: Agent list, deploy form
- Day 32-33: Metrics visualization
- Day 34-35: Runtime switcher UI

### Phase 3: Agent Features (Weeks 6-8)

**Week 6: State & Memory**
- Day 36-38: Unified state API
- Day 39-40: Vector search (Convex)
- Day 41-42: AgentCore Memory integration

**Week 7: Observability**
- Day 43-45: Logs viewer
- Day 46-47: Metrics dashboard
- Day 48-49: Error tracking

**Week 8: Dashboard Assistant**
- Day 50-52: Convex Agent Component setup
- Day 53-54: Build admin tools (deploy, analyze, etc.)
- Day 55-56: Integrate into UI

### Phase 4: Billing & Polish (Weeks 9-12)

**Week 9-10: Billing**
- Lemon Squeezy integration
- Usage tracking (both runtimes)
- Subscription plans UI
- Payment flow

**Week 11: Private Beta**
- 50 beta users
- Cloudflare runtime only
- Gather feedback
- Bug fixes

**Week 12: Public Launch**
- Add AgentCore runtime
- Product Hunt launch
- HackerNews "Show HN"
- Documentation site

---

## 7. Go-to-Market Strategy

### 7.1 Launch Channels

**Week 1-2: Private Beta**
- Twitter teaser (AI dev community)
- Direct outreach to 50 hand-picked developers
- AI Discord communities (LangChain, CrewAI, etc.)

**Week 3: Public Launch**
- Product Hunt launch
- HackerNews "Show HN: webhost.systems - Deploy AI agents with one command"
- Dev.to article
- Reddit r/artificial, r/MachineLearning

**Week 4+: Content Marketing**
- "Deploying Your First AI Agent in 5 Minutes"
- "LangGraph vs CrewAI: Which to Deploy?"
- "The Hidden Costs of Self-Hosting AI Agents"
- "When to Use Edge vs Cloud for Agent Hosting"

### 7.2 Differentiation Messaging

**vs. Railway/Heroku/Fly.io:**
- ✅ Agent-native (not generic PaaS)
- ✅ Built-in state management (no DIY Redis)
- ✅ Choice of runtimes (edge OR cloud)
- ✅ Pay-per-use pricing

**vs. Modal/Banana/Replicate:**
- ✅ Full agent lifecycle (not just inference)
- ✅ Persistent state
- ✅ Complete dashboard included
- ✅ Turnkey billing

**vs. AWS Bedrock AgentCore:**
- ✅ Multi-cloud (not AWS-locked)
- ✅ Free tier available
- ✅ TypeScript support
- ✅ Simpler pricing

---

## 8. Success Metrics

### 8.1 Product Metrics

**Activation:**
- 40% of signups deploy first agent (target)
- <10 min time to first deployment

**Retention:**
- 60% 30-day retention
- <5% monthly churn

**Usage:**
- Average 3 agents per paid user
- 70% choose Cloudflare runtime (economics)
- 30% upgrade to AgentCore (for long tasks)

### 8.2 Technical Metrics

**Performance:**
- Dashboard load: <2s (P95)
- Agent deployment: <3 min
- System uptime: 99.9%

**Reliability:**
- <1% deployment failures
- <0.1% data loss incidents

### 8.3 Business Metrics

**Year 1:**
- 1,000 free users
- 100 paying users
- $50 ARPU
- $5K MRR, $60K ARR

**Year 3:**
- 10,000 free users
- 1,000 paying users
- $75 ARPU
- $75K MRR, $900K ARR

**LTV:CAC:** 3:1 target

---

## 9. Risk Mitigation

### 9.1 Technical Risks

**Cloudflare limits hit:**
- **Mitigation:** Offer AgentCore as upgrade path
- **Fallback:** Add Fly.io as third runtime option

**AgentCore TypeScript SDK delay:**
- **Mitigation:** Build TypeScript wrapper ourselves
- **Status:** Monitor AWS roadmap

**Convex scaling issues:**
- **Mitigation:** PostgreSQL migration plan ready
- **Trigger:** >10K concurrent agents

### 9.2 Business Risks

**Framework vendor competition:**
- **Mitigation:** Multi-framework support, better DX
- **Strategy:** Partner with frameworks (host their examples)

**Low willingness to pay:**
- **Mitigation:** Free tier generates leads, usage-based scales
- **Data:** Track conversion rates, optimize pricing

**AWS/Cloudflare launch competing products:**
- **Mitigation:** Multi-cloud by design, can switch
- **Strategy:** Developer-first UX, community building

---

## 10. Open Questions & Decisions Needed

### 10.1 Technical

- [ ] Should we build custom TypeScript wrapper for AgentCore SDK?
- [ ] Do we support custom Docker images for AgentCore?
- [ ] Should we add Fly.io as third runtime option?

### 10.2 Product

- [ ] Should AgentCore be pay-per-use or fixed addon fee?
- [ ] Do we white-label AgentCore or show AWS branding?
- [ ] Should we build agent marketplace (pre-built agents)?

### 10.3 Business

- [ ] Enterprise sales motion vs product-led only?
- [ ] Partnership with LangChain/CrewAI for distribution?
- [ ] Self-hosted option for enterprise?

---

## 11. Competitive Analysis (UPDATED)

### 11.1 Direct Competitors

**AWS Bedrock AgentCore:**
- ✅ Most comprehensive features
- ✅ Enterprise-ready
- ❌ AWS lock-in
- ❌ Python-only
- ❌ Complex pricing
- **Our advantage:** Multi-cloud, TypeScript, simpler pricing, free tier

**Modal, Replicate, Banana:**
- ✅ Good for ML inference
- ❌ Not agent-native
- ❌ No built-in state/memory
- **Our advantage:** Agent-specific features, dashboard included

**Railway, Heroku, Fly.io:**
- ✅ General-purpose PaaS
- ❌ Not optimized for agents
- ❌ No agent primitives
- **Our advantage:** Agent-native, better economics for agent workloads

### 11.2 Indirect Competitors

**Vercel (for full-stack apps with agents):**
- ✅ Great DX, Next.js integration
- ❌ Not for hosting standalone agents
- ❌ 60s timeout limits
- **Our positioning:** "Use Vercel for your app, webhost.systems for your agents"

**Self-hosting (AWS/GCP/Azure):**
- ✅ Full control
- ❌ High DevOps overhead
- ❌ Complex setup
- **Our advantage:** Zero DevOps, instant deploy, managed

---

## 12. Portfolio Synergy

**Compositional Value:**

- **fleetprompt.com** → Agent marketplace, default hosting on webhost.systems
- **opensentience.org** → Agent runtime/governance, powers execution layer
- **agentromatic/agentelic** → Agent products, hosted on platform
- **delegatic.com** → Multi-agent orchestration

**Value Amplification:**
- Individual domains: $750K-$1.1M
- Integrated platform: $100M-$310M
- Full ecosystem: $200M-$500M+

webhost.systems is the **infrastructure layer** that makes the entire portfolio valuable.

---

## Appendix A: Technology Comparison

See `AGENT_RUNTIME_COMPARISON_UPDATED.md` for detailed comparison of:
- AWS Bedrock AgentCore
- Cloudflare Workers + Agents SDK
- Convex Agent Component
- Vercel AI SDK
- Microsoft Agent Framework
- Google Vertex AI Agent Engine

**TL;DR:** Multi-runtime (Cloudflare + AgentCore) gives best flexibility, economics, and features.

---

**END OF TECHNICAL SPECIFICATION v2.0**

*Next Steps:*
1. Review and approve architecture
2. Setup development environment
3. Begin Week 1 implementation
4. Launch private beta in 11 weeks
