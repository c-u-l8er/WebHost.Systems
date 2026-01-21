# webhost.systems - Implementation Guide v2.0

**Updated:** January 21, 2026  
**Multi-Runtime Architecture:** Cloudflare + AWS AgentCore + Convex Agents

---

## Quick Start Summary

**What Changed in v2.0:**
- ✅ Added AWS Bedrock AgentCore as enterprise runtime option
- ✅ Integrated Convex Agent Component for dashboard features
- ✅ Multi-runtime architecture (edge + cloud choice)
- ✅ Enhanced observability across runtimes
- ✅ Unified agent deployment API

**Tech Stack:**
- **Standard Runtime:** Cloudflare Workers (free tier, global edge)
- **Enterprise Runtime:** AWS Bedrock AgentCore (long tasks, MicroVM security)
- **Backend:** Convex (database + Agent Component for dashboard logic)
- **Agent Logic:** Vercel AI SDK v6 (provider abstraction)
- **Frontend:** React + Vite + Cloudflare Pages
- **Auth:** Clerk
- **Payments:** Lemon Squeezy

---

## Week-by-Week Implementation

### Week 1: Foundation Setup

#### Day 1-2: Project Initialization

**1. Create Project:**
```bash
# Initialize React + TypeScript project
npm create vite@latest webhost-systems -- --template react-ts
cd webhost-systems
npm install

# Install core dependencies
npm install @clerk/clerk-react convex @ai-sdk/openai ai zod
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**2. Setup Clerk:**
```bash
# Get Clerk keys from https://dashboard.clerk.com
# Add to .env.local
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

**3. Configure main.tsx:**
```typescript
import { ClerkProvider } from '@clerk/clerk-react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { ConvexReactClient } from 'convex/react'
import { useAuth } from '@clerk/clerk-react'

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY!}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <App />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>,
)
```

#### Day 3-4: Convex Backend

**1. Setup Convex:**
```bash
npx convex dev
# Follow prompts to create project
```

**2. Define Schema (`convex/schema.ts`):**
```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    subscriptionTier: v.union(
      v.literal("free"),
      v.literal("starter"),
      v.literal("pro"),
      v.literal("enterprise")
    ),
    defaultRuntime: v.union(
      v.literal("cloudflare"),
      v.literal("agentcore")
    ),
    createdAt: v.number(),
  }).index("by_clerk_id", ["clerkId"]),

  agents: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.string(),
    framework: v.string(),
    runtime: v.union(v.literal("cloudflare"), v.literal("agentcore")),
    
    // Runtime-specific config
    cloudflare: v.optional(v.object({
      workerUrl: v.string(),
      durableObjectId: v.string(),
    })),
    agentcore: v.optional(v.object({
      runtimeId: v.string(),
      region: v.string(),
      vCpu: v.number(),
      memoryMb: v.number(),
    })),
    
    status: v.union(
      v.literal("deploying"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("error")
    ),
    envVars: v.object({}),
    createdAt: v.number(),
    lastDeployedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_runtime", ["runtime"]),

  deployments: defineTable({
    agentId: v.id("agents"),
    version: v.string(),
    runtime: v.union(v.literal("cloudflare"), v.literal("agentcore")),
    commitHash: v.string(),
    status: v.string(),
    logs: v.array(v.string()),
    deployedAt: v.number(),
  }).index("by_agent", ["agentId"]),
});
```

**3. Create Basic Mutations:**
```typescript
// convex/agents.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    name: v.string(),
    framework: v.string(),
    runtime: v.union(v.literal("cloudflare"), v.literal("agentcore")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) throw new Error("User not found");

    const agentId = await ctx.db.insert("agents", {
      userId: user._id,
      name: args.name,
      framework: args.framework,
      runtime: args.runtime,
      status: "deploying",
      envVars: {},
      createdAt: Date.now(),
      lastDeployedAt: Date.now(),
    });

    return agentId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) return [];

    return await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});
```

#### Day 5-7: Basic UI

**1. Install UI Components:**
```bash
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card input label
```

**2. Create Dashboard (`src/Dashboard.tsx`):**
```typescript
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function Dashboard() {
  const agents = useQuery(api.agents.list);
  const createAgent = useMutation(api.agents.create);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">My Agents</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {agents?.map((agent) => (
          <Card key={agent._id} className="p-4">
            <h3 className="font-semibold">{agent.name}</h3>
            <p className="text-sm text-gray-600">{agent.framework}</p>
            <p className="text-xs text-gray-500">
              Runtime: {agent.runtime}
            </p>
            <span className={`
              inline-block px-2 py-1 text-xs rounded mt-2
              ${agent.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100'}
            `}>
              {agent.status}
            </span>
          </Card>
        ))}
      </div>
      
      <Button 
        onClick={() => createAgent({ 
          name: "New Agent", 
          framework: "custom",
          runtime: "cloudflare" 
        })}
        className="mt-6"
      >
        Create Agent
      </Button>
    </div>
  );
}
```

---

### Week 2: Cloudflare Integration

#### Day 8-10: Cloudflare Workers Setup

**1. Create Cloudflare Project:**
```bash
npm create cloudflare@latest agent-runtime
# Choose: Workers + TypeScript
cd agent-runtime
npm install
```

**2. Create Agent Worker (`src/index.ts`):**
```typescript
import { Agent } from '@cloudflare/agents-sdk';

export interface Env {
  AGENT_DO: DurableObjectNamespace;
  AI: Ai;
  CONVEX_URL: string;
}

export class AgentDO extends Agent<Env> {
  async onMessage(message: string) {
    // Get conversation history from state
    const history = await this.state.storage.get('history') || [];
    
    // Run agent with Workers AI
    const response = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: 'You are a helpful AI assistant.' },
        ...history,
        { role: 'user', content: message },
      ],
    });
    
    // Save to history
    history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response.response }
    );
    await this.state.storage.put('history', history);
    
    // Report metrics to Convex
    await this.reportMetrics({
      requests: 1,
      tokens: this.estimateTokens(message + response.response),
      runtime: 'cloudflare',
    });
    
    return {
      message: response.response,
      timestamp: Date.now(),
    };
  }
  
  private async reportMetrics(metrics: any) {
    await fetch(`${this.env.CONVEX_URL}/reportMetrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics),
    });
  }
  
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const id = env.AGENT_DO.idFromName(url.pathname.split('/')[2]);
    const stub = env.AGENT_DO.get(id);
    return stub.fetch(request);
  },
};
```

**3. Configure wrangler.toml:**
```toml
name = "webhost-agent-runtime"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "AGENT_DO"
class_name = "AgentDO"
script_name = "webhost-agent-runtime"

[ai]
binding = "AI"

[vars]
CONVEX_URL = "https://your-deployment.convex.cloud"
```

#### Day 11-12: Deployment API

**Create Convex Action for Deployment:**
```typescript
// convex/deploy.ts
import { action } from "./_generated/server";
import { v } from "convex/values";

export const deployToCloudflare = action({
  args: {
    agentId: v.id("agents"),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    // Call Cloudflare API to deploy worker
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{agent_id}', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/javascript',
      },
      body: args.code,
    });
    
    if (!response.ok) {
      throw new Error('Deployment failed');
    }
    
    const result = await response.json();
    
    // Update agent status
    await ctx.runMutation(api.agents.updateStatus, {
      agentId: args.agentId,
      status: 'active',
      workerUrl: result.url,
    });
    
    return result;
  },
});
```

---

### Week 3: AWS AgentCore Integration

#### Day 15-16: AgentCore Setup

**1. Install AgentCore SDK:**
```bash
pip install bedrock-agentcore
# Note: Python only for now, will need wrapper for TypeScript
```

**2. Create AgentCore Deployment Script:**
```python
# scripts/deploy_agentcore.py
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands_tools import file_read, file_write

app = BedrockAgentCoreApp()

@app.entrypoint
def agent_invocation(payload, context):
    # This gets called by AgentCore runtime
    user_message = payload.get("prompt", "")
    
    # Your agent logic here
    agent = Agent(tools=[file_read, file_write])
    result = agent(user_message)
    
    return {"result": result.message}

if __name__ == "__main__":
    app.run()
```

**3. Create Convex Action for AgentCore:**
```typescript
// convex/deployAgentCore.ts
import { action } from "./_generated/server";
import { v } from "convex/values";

export const deployToAgentCore = action({
  args: {
    agentId: v.id("agents"),
    pythonCode: v.string(),
  },
  handler: async (ctx, args) => {
    // Call Python script via exec (or API gateway)
    const result = await fetch('http://localhost:8000/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: args.agentId,
        code: args.pythonCode,
      }),
    });
    
    if (!result.ok) {
      throw new Error('AgentCore deployment failed');
    }
    
    const data = await result.json();
    
    await ctx.runMutation(api.agents.updateStatus, {
      agentId: args.agentId,
      status: 'active',
      agentcore: {
        runtimeId: data.runtimeId,
        region: data.region,
        vCpu: 2,
        memoryMb: 4096,
      },
    });
    
    return data;
  },
});
```

#### Day 17-21: Runtime Abstraction Layer

**Create Unified Deployment API:**
```typescript
// convex/deployAgent.ts
import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const deploy = action({
  args: {
    agentId: v.id("agents"),
    code: v.string(),
    runtime: v.union(v.literal("cloudflare"), v.literal("agentcore")),
  },
  handler: async (ctx, args) => {
    // Route to appropriate runtime
    if (args.runtime === "cloudflare") {
      return await ctx.runAction(api.deploy.deployToCloudflare, {
        agentId: args.agentId,
        code: args.code,
      });
    } else {
      return await ctx.runAction(api.deployAgentCore.deployToAgentCore, {
        agentId: args.agentId,
        pythonCode: args.code,
      });
    }
  },
});
```

---

### Week 4-5: Dashboard Features

#### Convex Agent Component Setup

**1. Install Agent Component:**
```bash
npm install @convex-dev/agent
```

**2. Create Dashboard Assistant:**
```typescript
// convex/dashboardAgent.ts
import { Agent } from "@convex-dev/agent";
import { tool } from "ai";
import { z } from "zod";
import { components } from "./_generated/api";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { openai } from "@ai-sdk/openai";

const dashboardAgent = new Agent(components.agent, {
  name: "Dashboard Assistant",
  chat: openai.chat("gpt-4o-mini"),
  instructions: `You help users manage their AI agents on webhost.systems. 
  You can deploy agents, check usage, analyze performance, and suggest optimizations.`,
  
  tools: {
    deployAgent: tool({
      description: "Deploy a new agent to Cloudflare or AgentCore",
      parameters: z.object({
        name: z.string(),
        runtime: z.enum(["cloudflare", "agentcore"]),
        framework: z.string(),
      }),
      execute: async ({ name, runtime, framework }, context) => {
        // Would call actual deployment API
        return `Agent "${name}" deployed to ${runtime} runtime`;
      },
    }),
    
    checkUsage: tool({
      description: "Check usage statistics for an agent",
      parameters: z.object({
        agentName: z.string(),
      }),
      execute: async ({ agentName }, context) => {
        // Query metrics from Convex
        return {
          requests: 1234,
          tokens: 50000,
          cost: 2.50,
          runtime: "cloudflare",
        };
      },
    }),
    
    suggestRuntime: tool({
      description: "Suggest best runtime based on agent requirements",
      parameters: z.object({
        maxRuntime: z.number().describe("Max runtime in seconds"),
        memoryNeeds: z.enum(["low", "medium", "high"]),
      }),
      execute: async ({ maxRuntime, memoryNeeds }) => {
        if (maxRuntime > 600 || memoryNeeds === "high") {
          return {
            recommended: "agentcore",
            reason: "Long runtime or high memory needs require AgentCore",
          };
        }
        return {
          recommended: "cloudflare",
          reason: "Cloudflare Workers is more cost-effective for this workload",
        };
      },
    }),
  },
});

export const chat = action({
  args: {
    prompt: v.string(),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let thread;
    
    if (args.threadId) {
      thread = await dashboardAgent.getThread(ctx, args.threadId);
    } else {
      const { thread: newThread, threadId } = await dashboardAgent.createThread(ctx);
      thread = newThread;
    }
    
    const result = await thread.generateText({ prompt: args.prompt });
    
    return {
      threadId: thread.id,
      response: result.text,
    };
  },
});
```

**3. Add Chat UI Component:**
```typescript
// src/components/DashboardChat.tsx
import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DashboardChat() {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string>();
  const chat = useMutation(api.dashboardAgent.chat);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    
    const result = await chat({ prompt: input, threadId });
    
    setThreadId(result.threadId);
    setMessages(prev => [...prev, { role: 'assistant', content: result.response }]);
    setInput('');
  };

  return (
    <div className="border rounded-lg p-4">
      <h3 className="font-semibold mb-4">Dashboard Assistant</h3>
      
      <div className="h-64 overflow-y-auto mb-4 space-y-2">
        {messages.map((msg, i) => (
          <div key={i} className={`p-2 rounded ${
            msg.role === 'user' ? 'bg-blue-100 ml-8' : 'bg-gray-100 mr-8'
          }`}>
            <p className="text-sm">{msg.content}</p>
          </div>
        ))}
      </div>
      
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask me anything..."
        />
        <Button onClick={handleSend}>Send</Button>
      </div>
    </div>
  );
}
```

---

### Week 6-8: Observability & Metrics

**1. Unified Metrics Collection:**
```typescript
// convex/metrics.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const report = mutation({
  args: {
    agentId: v.id("agents"),
    runtime: v.union(v.literal("cloudflare"), v.literal("agentcore")),
    requests: v.number(),
    tokens: v.number(),
    computeMs: v.number(),
    errors: v.number(),
    cloudflare: v.optional(v.object({
      durableObjectOps: v.number(),
      workersAICalls: v.number(),
    })),
    agentcore: v.optional(v.object({
      sessionDurationMs: v.number(),
      toolInvocations: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const timestamp = Math.floor(Date.now() / 3600000) * 3600000; // Round to hour
    
    await ctx.db.insert("metrics", {
      agentId: args.agentId,
      runtime: args.runtime,
      timestamp,
      requests: args.requests,
      llmTokens: args.tokens,
      computeMs: args.computeMs,
      errors: args.errors,
      cloudflare: args.cloudflare,
      agentcore: args.agentcore,
      costUsd: this.calculateCost(args),
    });
  },
  
  calculateCost(metrics: any): number {
    if (metrics.runtime === "cloudflare") {
      const workersCost = (metrics.requests / 1000000) * 0.50;
      const aiCost = (metrics.tokens / 1000) * 0.011;
      return workersCost + aiCost;
    } else {
      // AgentCore pricing (simplified)
      const runtimeCost = (metrics.computeMs / 1000) * 0.0001;
      const memoryCost = metrics.agentcore?.sessionDurationMs * 0.00001;
      return runtimeCost + memoryCost;
    }
  },
});
```

**2. Metrics Dashboard Component:**
```typescript
// src/components/MetricsDashboard.tsx
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

export function MetricsDashboard({ agentId }: { agentId: string }) {
  const metrics = useQuery(api.metrics.getByAgent, { agentId });

  const totalRequests = metrics?.reduce((sum, m) => sum + m.requests, 0) || 0;
  const totalCost = metrics?.reduce((sum, m) => sum + m.costUsd, 0) || 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <h4 className="text-sm text-gray-600">Total Requests</h4>
          <p className="text-2xl font-bold">{totalRequests.toLocaleString()}</p>
        </Card>
        
        <Card className="p-4">
          <h4 className="text-sm text-gray-600">Total Cost</h4>
          <p className="text-2xl font-bold">${totalCost.toFixed(2)}</p>
        </Card>
        
        <Card className="p-4">
          <h4 className="text-sm text-gray-600">Avg Response Time</h4>
          <p className="text-2xl font-bold">125ms</p>
        </Card>
      </div>
      
      <Card className="p-4">
        <h4 className="font-semibold mb-4">Requests Over Time</h4>
        <LineChart width={600} height={300} data={metrics}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="timestamp" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="requests" stroke="#8884d8" />
        </LineChart>
      </Card>
    </div>
  );
}
```

---

### Week 9-10: Billing Integration

**Lemon Squeezy Setup:**
```typescript
// convex/billing.ts
import { action } from "./_generated/server";
import { v } from "convex/values";

export const createCheckout = action({
  args: {
    tier: v.union(v.literal("starter"), v.literal("pro"), v.literal("enterprise")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: identity.email,
              custom: {
                user_id: identity.subject,
                tier: args.tier,
              },
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: process.env.LEMONSQUEEZY_STORE_ID } },
            variant: { data: { type: 'variants', id: this.getVariantId(args.tier) } },
          },
        },
      }),
    });

    const data = await response.json();
    return data.data.attributes.url; // Checkout URL
  },
  
  getVariantId(tier: string): string {
    const variants = {
      starter: process.env.LEMONSQUEEZY_STARTER_VARIANT_ID,
      pro: process.env.LEMONSQUEEZY_PRO_VARIANT_ID,
      enterprise: process.env.LEMONSQUEEZY_ENTERPRISE_VARIANT_ID,
    };
    return variants[tier];
  },
});
```

---

### Week 11: Private Beta

**Testing Checklist:**
- [ ] Deploy test agent to Cloudflare
- [ ] Deploy test agent to AgentCore
- [ ] Switch between runtimes
- [ ] Monitor metrics
- [ ] Test dashboard assistant
- [ ] Process test payment
- [ ] Load test (1000 concurrent requests)
- [ ] Security audit
- [ ] Documentation complete

---

### Week 12: Public Launch

**Launch Day Checklist:**
- [ ] Product Hunt submission ready
- [ ] HackerNews post written
- [ ] Twitter announcement thread
- [ ] Landing page live
- [ ] Documentation site live
- [ ] Support email setup
- [ ] Monitoring dashboards ready
- [ ] Incident response plan

---

## Environment Variables

**Frontend (.env.local):**
```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_CONVEX_URL=https://...convex.cloud
```

**Convex (npx convex env):**
```
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
LEMONSQUEEZY_API_KEY=...
LEMONSQUEEZY_STORE_ID=...
LEMONSQUEEZY_STARTER_VARIANT_ID=...
LEMONSQUEEZY_PRO_VARIANT_ID=...
```

**Cloudflare Workers (wrangler.toml):**
```toml
[vars]
CONVEX_URL = "https://...convex.cloud"
```

---

## Deployment Commands

**Frontend (Cloudflare Pages):**
```bash
npm run build
npx wrangler pages deploy dist
```

**Convex:**
```bash
npx convex deploy
```

**Cloudflare Workers:**
```bash
cd agent-runtime
npx wrangler deploy
```

---

## Monitoring & Debugging

**Convex Dashboard:**
- Real-time function logs
- Database queries
- Error tracking

**Cloudflare Dashboard:**
- Worker analytics
- Durable Object usage
- Error rates

**AWS Console (for AgentCore):**
- Runtime metrics
- CloudWatch logs
- Cost tracking

---

## Testing Strategy

**Unit Tests:**
```bash
npm test
```

**Integration Tests:**
```bash
# Test Cloudflare deployment
npm run test:cloudflare

# Test AgentCore deployment
npm run test:agentcore
```

**E2E Tests:**
```bash
npx playwright test
```

---

## Next Steps

1. Follow week-by-week plan
2. Join Discord for support
3. Read agent runtime comparison doc for deeper understanding
4. Start with Cloudflare runtime (simpler)
5. Add AgentCore later when needed

**Good luck building! 🚀**
