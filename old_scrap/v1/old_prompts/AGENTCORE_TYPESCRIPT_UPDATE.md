# CRITICAL UPDATE: AgentCore Has Full TypeScript Support!

**Date:** January 21, 2026  
**Discovery:** AWS Bedrock AgentCore has TWO TypeScript SDKs

---

## What Changed

Previously documented: "AgentCore Python-only SDK" ❌  
**CORRECTED:** AgentCore has **full TypeScript support** ✅

## Two TypeScript SDKs

### 1. `@aws-sdk/client-bedrock-agentcore` (Control Plane)
**Official AWS SDK for managing AgentCore resources**

```bash
npm install @aws-sdk/client-bedrock-agentcore
```

**Usage:**
```typescript
import { 
  BedrockAgentCoreClient, 
  InvokeAgentRuntimeCommand 
} from '@aws-sdk/client-bedrock-agentcore';

const client = new BedrockAgentCoreClient({ region: 'us-east-1' });

const command = new InvokeAgentRuntimeCommand({
  runtimeSessionId: 'session-123',
  agentRuntimeArn: 'arn:aws:bedrock-agentcore:...',
  payload: new TextEncoder().encode('Hello agent'),
});

const response = await client.send(command);
```

**Use for:**
- Deploying agents to AgentCore Runtime
- Managing agent sessions
- Invoking agents programmatically
- Controlling AgentCore resources

---

### 2. `bedrock-agentcore` (Tools SDK)
**AWS TypeScript SDK for Code Interpreter & Browser tools**

```bash
npm install bedrock-agentcore
npm install ai@beta @ai-sdk/amazon-bedrock@beta  # Vercel AI SDK v6
```

**Usage with Vercel AI SDK:**
```typescript
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { ToolLoopAgent } from 'ai';
import { CodeInterpreterTools } from 'bedrock-agentcore/code-interpreter/vercel-ai';
import { BrowserTools } from 'bedrock-agentcore/browser/vercel-ai';

const codeInterpreter = new CodeInterpreterTools();
const browser = new BrowserTools();

const agent = new ToolLoopAgent({
  model: bedrock('global.anthropic.claude-sonnet-4-20250514-v1:0'),
  tools: {
    ...codeInterpreter.tools,  // Execute Python/JS/TS code
    ...browser.tools,           // Web automation
  },
});

const result = await agent.run({
  prompt: 'Visit HackerNews and analyze top stories',
});
```

**Features:**
- ✅ **Code Interpreter** - Execute Python, JavaScript, TypeScript in secure sandbox
- ✅ **Browser Tool** - Playwright/Puppeteer-compatible web automation
- ✅ **Vercel AI SDK integration** - First-class support for AI SDK v6
- ✅ **TypeScript-native** - Full type safety
- ✅ **Streaming support** - Real-time agent responses

---

## What This Means for webhost.systems

### Previous Assessment (OUTDATED):
> "AgentCore is Python-only, not suitable for TypeScript developers"

### **NEW Assessment:**

**AgentCore is NOW a top-tier option:**

**Pros (UPDATED):**
- ✅ **Full TypeScript support** - Two comprehensive SDKs
- ✅ **Vercel AI SDK integration** - Best-in-class DX
- ✅ **Code Interpreter tools** - Python/JS/TS execution built-in
- ✅ **Browser tools** - Web automation included
- ✅ **Most comprehensive** - 9 services (Runtime, Memory, Gateway, Identity, etc.)
- ✅ **Enterprise-ready** - GA since Oct 2025, 1M+ downloads
- ✅ **MicroVM isolation** - Best security
- ✅ **Up to 8-hour runtimes** - Longest in industry

**Cons (UNCHANGED):**
- ❌ **AWS lock-in** - Still the biggest weakness
- ❌ **Complex pricing** - 9 services with different pricing
- ❌ **4 regions only** - vs Cloudflare's 310 cities

---

## Updated Architecture Recommendation

### Option A: AgentCore-First (NOW VIABLE)

```typescript
// webhost.systems with AgentCore (TypeScript!)

import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { ToolLoopAgent } from 'ai';
import { CodeInterpreterTools, BrowserTools } from 'bedrock-agentcore';

// Deploy to AgentCore Runtime
const client = new BedrockAgentCoreClient({ region: 'us-east-1' });

// Agent with built-in tools (TypeScript!)
const agent = new ToolLoopAgent({
  model: bedrock('claude-sonnet-4'),
  tools: {
    ...new CodeInterpreterTools().tools,
    ...new BrowserTools().tools,
    // Your custom tools
  },
});

// Fully TypeScript end-to-end
```

**Best for:**
- ✅ Enterprise customers (compliance, security)
- ✅ Long-running agents (>10 minutes)
- ✅ TypeScript-first teams (NOW VIABLE!)
- ✅ Need built-in browser/code tools
- ❌ Free tier users (AWS costs)
- ❌ Multi-cloud requirements

---

### Option B: Multi-Runtime (STILL RECOMMENDED)

```
Tier 1: Cloudflare Workers (Standard/Free)
  - 90% of users
  - Best economics
  - Global edge

Tier 2: AgentCore (Enterprise - NOW TYPESCRIPT!)
  - 10% of users (premium)
  - Long-running tasks
  - Built-in tools
  - TypeScript-native
  - Enterprise features

Dashboard: Convex Agents
  - Support chatbot
  - Admin tools
  - TypeScript-native
```

**This is STILL the best approach** because:
- ✅ Free tier on Cloudflare (customer acquisition)
- ✅ Premium tier on AgentCore (revenue)
- ✅ TypeScript end-to-end (both platforms)
- ✅ No forced vendor lock-in
- ✅ Best economics

---

## Code Examples (TypeScript!)

### Deploy Agent to AgentCore

```typescript
// convex/deployAgentCore.ts
import { action } from "./_generated/server";
import { v } from "convex/values";
import { BedrockAgentCoreClient, CreateAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';

export const deployToAgentCore = action({
  args: {
    agentId: v.id("agents"),
    code: v.string(),  // TypeScript code!
  },
  handler: async (ctx, args) => {
    const client = new BedrockAgentCoreClient({ 
      region: process.env.AWS_REGION 
    });
    
    // Deploy TypeScript agent to AgentCore
    const command = new CreateAgentRuntimeCommand({
      agentName: `agent-${args.agentId}`,
      code: args.code,
      runtime: 'nodejs20',  // TypeScript support!
    });
    
    const response = await client.send(command);
    
    // Update Convex DB
    await ctx.runMutation(api.agents.updateStatus, {
      agentId: args.agentId,
      status: 'active',
      agentcore: {
        runtimeId: response.runtimeId,
        region: process.env.AWS_REGION,
      },
    });
    
    return response;
  },
});
```

### Build Agent with AgentCore Tools

```typescript
// agent/index.ts (webhost.systems hosted agent)
import { ToolLoopAgent } from 'ai';
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { CodeInterpreterTools } from 'bedrock-agentcore/code-interpreter/vercel-ai';
import { BrowserTools } from 'bedrock-agentcore/browser/vercel-ai';

const codeInterpreter = new CodeInterpreterTools();
const browser = new BrowserTools();

export const agent = new ToolLoopAgent({
  model: bedrock('anthropic.claude-sonnet-4'),
  tools: {
    ...codeInterpreter.tools,
    ...browser.tools,
  },
  maxSteps: 10,
});

// User invokes agent
const result = await agent.run({
  prompt: 'Analyze my website performance and create a report',
});

// Agent automatically:
// 1. Uses browser tool to visit website
// 2. Uses code interpreter to analyze data
// 3. Uses code interpreter to generate charts
// 4. Returns comprehensive report
```

---

## Updated Comparison Matrix

| Feature | Cloudflare | AgentCore | Convex Agents |
|---------|-----------|-----------|---------------|
| **TypeScript SDK** | ✅ YES | ✅ **YES** (NEW!) | ✅ YES |
| **Code Execution** | ⚠️ DIY | ✅ Built-in | ❌ No |
| **Browser Tools** | ⚠️ Puppeteer | ✅ Built-in | ❌ No |
| **AI SDK Integration** | ✅ YES | ✅ **YES** (NEW!) | ✅ YES |
| **Free Tier** | ✅ 100K/day | ❌ No | ✅ Generous |
| **Max Runtime** | ~10 min | ✅ 8 hours | 60 seconds |
| **Vendor Lock-in** | ✅ Low | ❌ High (AWS) | ⚠️ Medium |
| **Global Edge** | ✅ 310 cities | ❌ 4 regions | ❌ No |
| **Best For** | Free tier | Enterprise | Dashboard |

---

## Final Recommendation (UPDATED)

### **Strategy: Multi-Runtime with AgentCore TypeScript**

1. **Start with Cloudflare** for free tier
2. **Add AgentCore** as premium option (NOW easier with TypeScript)
3. **Use Convex Agents** for dashboard features

**Why this STILL wins:**
- ✅ TypeScript end-to-end (all platforms now)
- ✅ Free tier (Cloudflare) for acquisition
- ✅ Premium tier (AgentCore) for revenue
- ✅ No forced vendor lock-in
- ✅ Best DX (TypeScript everywhere)

**AgentCore is NOW much more attractive** with full TypeScript support, but multi-runtime is still the best strategy to avoid AWS lock-in while offering enterprise features.

---

## Action Items

- [x] ~~Document that AgentCore is Python-only~~ ❌ INCORRECT
- [ ] Update all docs with TypeScript SDK info
- [ ] Test `bedrock-agentcore` npm package
- [ ] Build AgentCore deployment pipeline (TypeScript)
- [ ] Update implementation guide with AgentCore TypeScript examples
- [ ] Add AgentCore tools showcase to landing page

---

## References

- **bedrock-agentcore npm:** https://www.npmjs.com/package/bedrock-agentcore
- **@aws-sdk/client-bedrock-agentcore:** https://www.npmjs.com/package/@aws-sdk/client-bedrock-agentcore
- **GitHub Repo:** https://github.com/aws/bedrock-agentcore-sdk-typescript
- **AI SDK Integration:** https://ai-sdk.dev/tools-registry/bedrock-agentcore
- **Vercel AI SDK v6:** https://vercel.com/blog/ai-sdk-6

---

**TL;DR:** AgentCore has full TypeScript support. This makes it a much stronger contender for webhost.systems. Multi-runtime strategy (Cloudflare + AgentCore) is still best, but AgentCore should be given more weight in the architecture.
