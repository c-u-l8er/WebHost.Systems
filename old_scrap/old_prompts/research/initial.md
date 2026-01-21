# AgentCore TypeScript Implementation Guide
**Supplement to webhost.systems spec_v1**  
**Date:** January 21, 2026  
**Version:** 1.0  
**Status:** Implementation-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [AgentCore SDK Versions & Installation](#agentcore-sdk-versions--installation)
3. [Runtime Capability Matrix](#runtime-capability-matrix)
4. [AgentCore Adapter Implementation](#agentcore-adapter-implementation)
5. [Deployment Artifact Format](#deployment-artifact-format)
6. [Tool Enablement Strategy](#tool-enablement-strategy)
7. [Tier Entitlements & Feature Gating](#tier-entitlements--feature-gating)
8. [Cost Estimation Implementation](#cost-estimation-implementation)
9. [Testing Requirements](#testing-requirements)
10. [Common Pitfalls & Solutions](#common-pitfalls--solutions)

---

## Overview

This guide provides the concrete implementation details for integrating AWS Bedrock AgentCore as the premium runtime provider in webhost.systems. It supplements the ADRs with specific SDK versions, code examples, and operational decisions needed to build the AgentCore adapter.

**Key Principle:** AgentCore support is TypeScript-native end-to-end. No Python required.

---

## AgentCore SDK Versions & Installation

### Recommended SDK Versions (January 2026)

```json
{
  "dependencies": {
    "@aws-sdk/client-bedrock-agentcore": "^3.968.0",
    "bedrock-agentcore": "^0.1.1",
    "@ai-sdk/amazon-bedrock": "^0.1.0",
    "ai": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

### Installation

```bash
# Control plane (Convex)
npm install @aws-sdk/client-bedrock-agentcore

# Agent runtime (optional, for built-in tools)
npm install bedrock-agentcore ai @ai-sdk/amazon-bedrock
```

### Version Pinning Strategy

**Recommendation:** Pin to minor versions (^3.968.0) to get patches automatically while avoiding breaking changes.

**Update Schedule:**
- Review AWS SDK updates quarterly
- Test in staging before updating production
- Document breaking changes in release notes

---

## Runtime Capability Matrix

This matrix drives UI toggles, tier gating, and adapter behavior.

### Cloudflare Workers Runtime

| Capability | Availability | Implementation |
|-----------|--------------|----------------|
| **TypeScript** | ✅ Native | V8 runtime with esbuild |
| **Max Runtime** | ~10 minutes | Worker CPU time limit |
| **State Management** | ✅ Durable Objects | Manual implementation |
| **Memory/RAG** | ⚠️ DIY | Store in Durable Objects or Convex |
| **Code Execution** | ⚠️ DIY | Use Workers AI or external service |
| **Browser Automation** | ⚠️ DIY | Puppeteer via external service |
| **Streaming** | ✅ Native | Native SSE support |
| **Global Edge** | ✅ 310+ cities | Cloudflare network |
| **Session State** | ✅ Automatic | Durable Objects storage |

### AgentCore Runtime

| Capability | Availability | Implementation |
|-----------|--------------|----------------|
| **TypeScript** | ✅ Native | Node.js 20+ runtime |
| **Max Runtime** | ✅ 8 hours | Configurable timeout |
| **State Management** | ✅ Built-in | AgentCore Memory service |
| **Memory/RAG** | ✅ Built-in | Episodic + semantic memory |
| **Code Execution** | ✅ Built-in | Code Interpreter (Python/JS/TS) |
| **Browser Automation** | ✅ Built-in | Managed Chrome instances |
| **Streaming** | ⚠️ Adapter emulation | Buffer & chunk responses |
| **Global Edge** | ⚠️ 4 regions | us-east-1, us-west-2, eu-west-1, ap-southeast-2 |
| **Session State** | ✅ Automatic | AgentCore Memory service |

### Capability Flags in Data Model

```typescript
// agents.providerConfig
providerConfig: {
  cloudflare: {
    workerName: string;
    durableObjectNamespace?: string;
  };
  agentcore: {
    region: string;  // us-east-1 | us-west-2 | eu-west-1 | ap-southeast-2
    vCpu: number;    // 1-4
    memoryMb: number; // 512-4096
    // Feature flags (tier-dependent)
    memoryEnabled: boolean;
    codeInterpreterEnabled: boolean;
    browserEnabled: boolean;
  };
}

// deployments.providerRef
providerRef: {
  agentcore?: {
    agentRuntimeArn: string;
    region: string;
    // Snapshot of enabled features at deploy time
    memoryEnabled?: boolean;
    codeInterpreterEnabled?: boolean;
    browserEnabled?: boolean;
  };
}
```

---

## AgentCore Adapter Implementation

### Complete TypeScript Adapter (Annotated)

```typescript
// convex/runtimeProviders/agentcore.ts

import {
  BedrockAgentCoreClient,
  CreateAgentRuntimeCommand,
  UpdateAgentRuntimeCommand,
  InvokeAgentRuntimeCommand,
  DeleteAgentRuntimeCommand,
  DescribeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { RuntimeProvider, Deployment, InvokeInput, InvokeOutput } from './types';

export class AgentCoreAdapter implements RuntimeProvider {
  private client: BedrockAgentCoreClient;
  private region: string;

  constructor(region: string = process.env.AWS_REGION || 'us-east-1') {
    this.region = region;
    this.client = new BedrockAgentCoreClient({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  /**
   * Deploy: Create AgentCore Runtime with agent code
   */
  async deploy(deployment: Deployment): Promise<ProviderRef> {
    const { agentId, artifact, telemetryAuthRef, envVarKeys, providerConfig } = deployment;
    
    // 1. Prepare environment variables
    const environmentVariables: Record<string, string> = {
      // Telemetry signing secret (deployment-scoped)
      TELEMETRY_SECRET: telemetryAuthRef,
      // Customer secrets (injected from provider secret store)
      ...await this.getCustomerSecrets(agentId, envVarKeys),
    };

    // 2. Prepare agent code bundle
    // Note: AgentCore expects a container image or bundled code archive
    const codeBundle = await this.prepareCodeBundle(artifact);

    // 3. Create AgentCore Runtime
    const command = new CreateAgentRuntimeCommand({
      // Naming convention for tracking
      name: `whs-agent-${agentId}-${deployment._id}`,
      
      // Runtime configuration
      runtime: 'nodejs20', // TypeScript support
      code: codeBundle,
      
      // Environment variables (includes secrets)
      environmentVariables,
      
      // Resource allocation (from providerConfig)
      compute: {
        vCpu: providerConfig.agentcore?.vCpu || 1,
        memoryMb: providerConfig.agentcore?.memoryMb || 2048,
      },
      
      // Feature enablement (tier-dependent)
      memory: providerConfig.agentcore?.memoryEnabled ? {
        enabled: true,
        retentionDays: 30, // Configurable by tier
      } : undefined,
      
      codeInterpreter: providerConfig.agentcore?.codeInterpreterEnabled ? {
        enabled: true,
        languages: ['python', 'javascript', 'typescript'],
        timeout: 900, // 15 minutes default
      } : undefined,
      
      browser: providerConfig.agentcore?.browserEnabled ? {
        enabled: true,
        timeout: 300, // 5 minutes default
      } : undefined,
      
      // Resource tagging (for cost tracking and cleanup)
      tags: [
        { key: 'platform', value: 'webhost-systems' },
        { key: 'userId', value: deployment.userId },
        { key: 'agentId', value: agentId },
        { key: 'deploymentId', value: deployment._id },
      ],
    });

    try {
      const response = await this.client.send(command);
      
      return {
        agentcore: {
          agentRuntimeArn: response.agentRuntimeArn!,
          region: this.region,
          // Snapshot feature flags
          memoryEnabled: providerConfig.agentcore?.memoryEnabled,
          codeInterpreterEnabled: providerConfig.agentcore?.codeInterpreterEnabled,
          browserEnabled: providerConfig.agentcore?.browserEnabled,
        },
      };
    } catch (error) {
      // Map AWS errors to normalized error codes
      throw this.mapError(error, 'deploy');
    }
  }

  /**
   * Update: Update existing AgentCore Runtime (e.g., secret rotation)
   */
  async update(deployment: Deployment, updates: Partial<Deployment>): Promise<void> {
    const { agentRuntimeArn } = deployment.providerRef.agentcore!;

    // Prepare updated environment variables if secrets changed
    const environmentVariables = updates.envVarKeys ? {
      TELEMETRY_SECRET: deployment.telemetryAuthRef,
      ...await this.getCustomerSecrets(deployment.agentId, updates.envVarKeys),
    } : undefined;

    const command = new UpdateAgentRuntimeCommand({
      agentRuntimeArn,
      environmentVariables,
      // Other updateable fields as needed
    });

    try {
      await this.client.send(command);
    } catch (error) {
      throw this.mapError(error, 'update');
    }
  }

  /**
   * Invoke: Execute agent with input
   */
  async invoke(deployment: Deployment, input: InvokeInput): Promise<InvokeOutput> {
    const { agentRuntimeArn } = deployment.providerRef.agentcore!;
    
    // Generate or use existing session ID
    const runtimeSessionId = input.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn,
      runtimeSessionId,
      // Encode input as JSON payload
      payload: new TextEncoder().encode(JSON.stringify({
        messages: input.messages,
        // Pass through any additional context
        context: input.context,
      })),
    });

    try {
      const response = await this.client.send(command);
      
      // Decode response
      const responseText = await response.response.transformToString();
      const parsed = JSON.parse(responseText);

      return {
        text: parsed.output || parsed.text || '',
        sessionId: runtimeSessionId,
        usage: {
          tokens: parsed.usage?.tokens,
          computeMs: parsed.usage?.computeMs || parsed.usage?.durationMs,
          toolCalls: parsed.usage?.toolCalls,
        },
        traceId: input.traceId,
      };
    } catch (error) {
      // Handle session expiration gracefully
      if (this.isSessionExpiredError(error)) {
        throw {
          code: 'RUNTIME_ERROR',
          message: 'Session expired or not found',
          retryable: false,
        };
      }
      throw this.mapError(error, 'invoke');
    }
  }

  /**
   * Delete: Clean up AgentCore Runtime
   */
  async delete(deployment: Deployment): Promise<void> {
    const { agentRuntimeArn } = deployment.providerRef.agentcore!;

    const command = new DeleteAgentRuntimeCommand({
      agentRuntimeArn,
    });

    try {
      await this.client.send(command);
    } catch (error) {
      // Idempotent: if already deleted, succeed
      if (this.isNotFoundError(error)) {
        return;
      }
      throw this.mapError(error, 'delete');
    }
  }

  /**
   * Health check: Verify runtime is operational
   */
  async healthCheck(deployment: Deployment): Promise<{ healthy: boolean; details?: string }> {
    const { agentRuntimeArn } = deployment.providerRef.agentcore!;

    const command = new DescribeAgentRuntimeCommand({
      agentRuntimeArn,
    });

    try {
      const response = await this.client.send(command);
      return {
        healthy: response.status === 'ACTIVE',
        details: response.status,
      };
    } catch (error) {
      return {
        healthy: false,
        details: (error as Error).message,
      };
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Prepare code bundle for AgentCore deployment
   */
  private async prepareCodeBundle(artifact: Artifact): Promise<string> {
    // Implementation depends on artifact format
    // Options:
    // 1. Upload to S3, return S3 URI
    // 2. Inline code (for small bundles)
    // 3. Container image URI (for complex dependencies)
    
    if (artifact.type === 's3') {
      return artifact.s3Uri;
    }
    
    if (artifact.type === 'inline') {
      return artifact.code;
    }
    
    throw new Error(`Unsupported artifact type: ${artifact.type}`);
  }

  /**
   * Get customer secrets from provider secret store
   */
  private async getCustomerSecrets(
    agentId: string,
    envVarKeys: string[]
  ): Promise<Record<string, string>> {
    // Implementation depends on secret storage strategy
    // For v1: retrieve from injected secrets (already in runtime)
    // For post-v1: retrieve from AWS Secrets Manager
    
    const secrets: Record<string, string> = {};
    
    for (const key of envVarKeys) {
      // Placeholder: actual implementation retrieves from secret store
      secrets[key] = process.env[`SECRET_${agentId}_${key}`] || '';
    }
    
    return secrets;
  }

  /**
   * Map AWS SDK errors to normalized error codes
   */
  private mapError(error: unknown, operation: string): Error {
    const err = error as any;
    
    // Map common AWS errors
    if (err.name === 'ResourceNotFoundException') {
      return {
        code: 'NOT_FOUND',
        message: `AgentCore resource not found during ${operation}`,
        retryable: false,
      } as any;
    }
    
    if (err.name === 'ThrottlingException') {
      return {
        code: 'RATE_LIMITED',
        message: 'AgentCore rate limit exceeded',
        retryable: true,
      } as any;
    }
    
    if (err.name === 'ValidationException') {
      return {
        code: 'INVALID_REQUEST',
        message: err.message || 'Invalid AgentCore configuration',
        retryable: false,
      } as any;
    }
    
    // Generic runtime error
    return {
      code: 'RUNTIME_ERROR',
      message: err.message || 'AgentCore operation failed',
      retryable: err.retryable !== false,
    } as any;
  }

  /**
   * Check if error is session expiration
   */
  private isSessionExpiredError(error: unknown): boolean {
    const err = error as any;
    return err.name === 'SessionExpiredException' || 
           err.message?.includes('session') && err.message?.includes('expired');
  }

  /**
   * Check if error is resource not found
   */
  private isNotFoundError(error: unknown): boolean {
    const err = error as any;
    return err.name === 'ResourceNotFoundException';
  }
}

// ==================== Type Definitions ====================

interface ProviderRef {
  agentcore?: {
    agentRuntimeArn: string;
    region: string;
    memoryEnabled?: boolean;
    codeInterpreterEnabled?: boolean;
    browserEnabled?: boolean;
  };
}

interface Artifact {
  type: 's3' | 'inline' | 'container';
  s3Uri?: string;
  code?: string;
  containerImage?: string;
}
```

---

## Deployment Artifact Format

### Node.js 20 Runtime Requirements

AgentCore expects a **Node.js 20+ compatible bundle** with the following structure:

```
agent-bundle/
├── package.json       # Dependencies manifest
├── index.js          # Entry point (compiled TypeScript)
├── node_modules/     # Dependencies (optional, can be pre-installed)
└── lib/              # Additional code modules
```

### Entry Point Contract

The entry point (`index.js`) must export an async handler function:

```typescript
// agent-bundle/index.js (compiled from TypeScript)

export async function handler(event) {
  const { messages, context } = JSON.parse(event.body);
  
  // Agent logic here
  const response = await processMessages(messages);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      output: response.text,
      usage: {
        tokens: response.tokens,
        computeMs: response.computeMs,
        toolCalls: response.toolCalls,
      },
    }),
  };
}
```

### Packaging Strategy

**Option 1: S3 Upload (Recommended for v1)**

```typescript
// convex/deploy/packageAgent.ts

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';

async function packageAgentToS3(
  agentId: string,
  deploymentId: string,
  sourceDir: string
): Promise<string> {
  // 1. Create zip archive
  const zipPath = `/tmp/${deploymentId}.zip`;
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.pipe(output);
  archive.directory(sourceDir, false);
  await archive.finalize();
  
  // 2. Upload to S3
  const s3 = new S3Client({ region: process.env.AWS_REGION });
  const key = `agents/${agentId}/deployments/${deploymentId}.zip`;
  
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AGENT_ARTIFACTS_BUCKET,
    Key: key,
    Body: fs.readFileSync(zipPath),
    ContentType: 'application/zip',
  }));
  
  // 3. Return S3 URI
  return `s3://${process.env.AGENT_ARTIFACTS_BUCKET}/${key}`;
}
```

**Option 2: Inline Code (Small Agents Only)**

```typescript
// For very small agents (<1MB), inline the code directly
async function packageAgentInline(sourceCode: string): Promise<string> {
  // Base64 encode for transport
  return Buffer.from(sourceCode).toString('base64');
}
```

### Build Pipeline

```bash
# Agent build script (executed by control plane)

#!/bin/bash
set -e

AGENT_DIR=$1
OUTPUT_DIR=$2

cd "$AGENT_DIR"

# 1. Install dependencies
npm ci --production

# 2. Compile TypeScript
npx tsc --outDir "$OUTPUT_DIR"

# 3. Copy runtime dependencies
cp package.json "$OUTPUT_DIR/"
cp -r node_modules "$OUTPUT_DIR/"

# 4. Create deployment artifact
cd "$OUTPUT_DIR"
zip -r ../agent.zip .

echo "Built agent artifact: $(pwd)/../agent.zip"
```

---

## Tool Enablement Strategy

### v1 Recommendation: Enterprise-Only Tools

**Rationale:**
- Built-in tools (Code Interpreter + Browser) are premium features
- Cost concentration: single tool invocation can be expensive
- Enterprise tier can absorb higher per-request costs

**Tier Mapping:**

```typescript
// Tier entitlements for AgentCore tools

const TIER_ENTITLEMENTS = {
  free: {
    agentcoreEnabled: false,
    memoryEnabled: false,
    codeInterpreterEnabled: false,
    browserEnabled: false,
  },
  
  starter: {
    agentcoreEnabled: false,
    memoryEnabled: false,
    codeInterpreterEnabled: false,
    browserEnabled: false,
  },
  
  pro: {
    agentcoreEnabled: true,  // AgentCore runtime access
    memoryEnabled: true,     // Built-in memory
    codeInterpreterEnabled: false,  // Tools reserved for enterprise
    browserEnabled: false,
  },
  
  enterprise: {
    agentcoreEnabled: true,
    memoryEnabled: true,
    codeInterpreterEnabled: true,  // ✅ Code Interpreter enabled
    browserEnabled: true,           // ✅ Browser enabled
  },
};
```

### Alternative: Pro-Tier Tools with Usage Limits

If you want to offer tools at Pro tier:

```typescript
const TIER_ENTITLEMENTS = {
  // ... free/starter same as above
  
  pro: {
    agentcoreEnabled: true,
    memoryEnabled: true,
    codeInterpreterEnabled: true,  // ✅ Enabled with limits
    browserEnabled: true,           // ✅ Enabled with limits
    // Additional limits
    maxToolCallsPerMonth: 1000,    // Tool usage cap
    maxCodeExecutionSeconds: 3600, // 1 hour total compute
    maxBrowserSessions: 100,       // Browser session cap
  },
  
  enterprise: {
    agentcoreEnabled: true,
    memoryEnabled: true,
    codeInterpreterEnabled: true,
    browserEnabled: true,
    maxToolCallsPerMonth: 50000,   // Higher limits
    maxCodeExecutionSeconds: 86400, // 24 hours
    maxBrowserSessions: 5000,
  },
};
```

**Implementation:** Track tool usage in `metricsEvents` with dedicated counters:

```typescript
// metricsEvents schema addition
{
  // ... existing fields
  provider: {
    agentcore?: {
      codeInterpreterCalls?: number;
      codeInterpreterSeconds?: number;
      browserSessions?: number;
      browserSeconds?: number;
    };
  };
}
```

---

## Tier Entitlements & Feature Gating

### Complete Entitlement Schema

```typescript
// convex/entitlements.ts

export interface TierEntitlements {
  // Billing & limits
  maxRequestsPerPeriod: number;
  maxTokensPerPeriod: number;
  maxComputeMsPerPeriod: number;
  
  // Runtime access
  agentcoreEnabled: boolean;
  
  // AgentCore features (only if agentcoreEnabled=true)
  memoryEnabled: boolean;
  codeInterpreterEnabled: boolean;
  browserEnabled: boolean;
  
  // AgentCore tool limits (if tools enabled)
  maxToolCallsPerPeriod?: number;
  maxCodeExecutionSeconds?: number;
  maxBrowserSessions?: number;
  
  // Resource limits
  maxAgents: number;
  maxDeploymentsPerAgent: number;
  maxConcurrentInvocations: number;
  
  // Retention & observability
  telemetryRetentionDays: number;
  logsRetentionDays: number;
  fullTracesEnabled: boolean;
  
  // Support & SLA
  supportLevel: 'community' | 'email' | 'priority';
  slaUptime?: number; // percentage
}

export const TIER_ENTITLEMENTS: Record<string, TierEntitlements> = {
  free: {
    maxRequestsPerPeriod: 10_000,
    maxTokensPerPeriod: 100_000,
    maxComputeMsPerPeriod: 600_000, // 10 minutes
    
    agentcoreEnabled: false,
    memoryEnabled: false,
    codeInterpreterEnabled: false,
    browserEnabled: false,
    
    maxAgents: 1,
    maxDeploymentsPerAgent: 3,
    maxConcurrentInvocations: 5,
    
    telemetryRetentionDays: 7,
    logsRetentionDays: 3,
    fullTracesEnabled: false,
    
    supportLevel: 'community',
  },
  
  starter: {
    maxRequestsPerPeriod: 100_000,
    maxTokensPerPeriod: 1_000_000,
    maxComputeMsPerPeriod: 3_600_000, // 1 hour
    
    agentcoreEnabled: false,
    memoryEnabled: false,
    codeInterpreterEnabled: false,
    browserEnabled: false,
    
    maxAgents: 5,
    maxDeploymentsPerAgent: 10,
    maxConcurrentInvocations: 20,
    
    telemetryRetentionDays: 30,
    logsRetentionDays: 14,
    fullTracesEnabled: false,
    
    supportLevel: 'email',
  },
  
  pro: {
    maxRequestsPerPeriod: 1_000_000,
    maxTokensPerPeriod: 10_000_000,
    maxComputeMsPerPeriod: 36_000_000, // 10 hours
    
    agentcoreEnabled: true,
    memoryEnabled: true,
    codeInterpreterEnabled: false, // Enterprise-only in v1
    browserEnabled: false,         // Enterprise-only in v1
    
    maxAgents: 50,
    maxDeploymentsPerAgent: 50,
    maxConcurrentInvocations: 100,
    
    telemetryRetentionDays: 90,
    logsRetentionDays: 30,
    fullTracesEnabled: true,
    
    supportLevel: 'email',
  },
  
  enterprise: {
    maxRequestsPerPeriod: 10_000_000,
    maxTokensPerPeriod: 100_000_000,
    maxComputeMsPerPeriod: 360_000_000, // 100 hours
    
    agentcoreEnabled: true,
    memoryEnabled: true,
    codeInterpreterEnabled: true,  // ✅ Tools enabled
    browserEnabled: true,           // ✅ Tools enabled
    
    // Tool-specific limits
    maxToolCallsPerPeriod: 100_000,
    maxCodeExecutionSeconds: 86_400, // 24 hours
    maxBrowserSessions: 10_000,
    
    maxAgents: -1, // Unlimited
    maxDeploymentsPerAgent: -1,
    maxConcurrentInvocations: 500,
    
    telemetryRetentionDays: 365,
    logsRetentionDays: 90,
    fullTracesEnabled: true,
    
    supportLevel: 'priority',
    slaUptime: 99.9,
  },
};
```

### Enforcement Points

**1. Deploy-Time Gating**

```typescript
// convex/deploy.ts

export const deployAgent = mutation({
  args: { agentId: v.id('agents'), runtimeProvider: v.string() },
  handler: async (ctx, args) => {
    // 1. Get user tier
    const user = await ctx.auth.getUserIdentity();
    const tier = await ctx.db.query('users')
      .filter(q => q.eq(q.field('clerkId'), user.sub))
      .first()
      .then(u => u?.tier || 'free');
    
    const entitlements = TIER_ENTITLEMENTS[tier];
    
    // 2. Enforce runtime gating
    if (args.runtimeProvider === 'agentcore' && !entitlements.agentcoreEnabled) {
      throw new Error('AgentCore runtime requires Pro tier or higher');
    }
    
    // 3. Enforce feature gating for AgentCore
    if (args.runtimeProvider === 'agentcore') {
      const agent = await ctx.db.get(args.agentId);
      const config = agent.providerConfig?.agentcore;
      
      if (config?.codeInterpreterEnabled && !entitlements.codeInterpreterEnabled) {
        throw new Error('Code Interpreter requires Enterprise tier');
      }
      
      if (config?.browserEnabled && !entitlements.browserEnabled) {
        throw new Error('Browser automation requires Enterprise tier');
      }
    }
    
    // 4. Proceed with deployment...
  },
});
```

**2. Invoke-Time Gating**

```typescript
// convex/invoke.ts

export const invokeAgent = mutation({
  args: { agentId: v.id('agents'), input: v.object({ /* ... */ }) },
  handler: async (ctx, args) => {
    // 1. Load agent and deployment
    const agent = await ctx.db.get(args.agentId);
    const deployment = await ctx.db.get(agent.activeDeploymentId);
    
    // 2. Enforce runtime gating
    if (deployment.runtimeProvider === 'agentcore') {
      const tier = await getUserTier(ctx);
      const entitlements = TIER_ENTITLEMENTS[tier];
      
      if (!entitlements.agentcoreEnabled) {
        throw new Error('AgentCore runtime not available on current tier');
      }
    }
    
    // 3. Enforce usage limits (requests, tokens, compute)
    // ... (existing limit checks from ADR-0007)
    
    // 4. Proceed with invocation...
  },
});
```

**3. UI Feature Toggles**

```typescript
// React component: AgentConfiguration

function AgentConfiguration({ agent, userTier }) {
  const entitlements = TIER_ENTITLEMENTS[userTier];
  
  return (
    <div>
      <label>Runtime Provider</label>
      <select disabled={!entitlements.agentcoreEnabled}>
        <option value="cloudflare">Cloudflare (Standard)</option>
        <option value="agentcore" disabled={!entitlements.agentcoreEnabled}>
          AgentCore (Premium) {!entitlements.agentcoreEnabled && '- Pro tier required'}
        </option>
      </select>
      
      {agent.runtimeProvider === 'agentcore' && (
        <>
          <label>
            <input
              type="checkbox"
              checked={agent.providerConfig?.agentcore?.memoryEnabled}
              disabled={!entitlements.memoryEnabled}
            />
            Enable Memory (RAG)
          </label>
          
          <label>
            <input
              type="checkbox"
              checked={agent.providerConfig?.agentcore?.codeInterpreterEnabled}
              disabled={!entitlements.codeInterpreterEnabled}
            />
            Enable Code Interpreter {!entitlements.codeInterpreterEnabled && '- Enterprise required'}
          </label>
          
          <label>
            <input
              type="checkbox"
              checked={agent.providerConfig?.agentcore?.browserEnabled}
              disabled={!entitlements.browserEnabled}
            />
            Enable Browser {!entitlements.browserEnabled && '- Enterprise required'}
          </label>
        </>
      )}
    </div>
  );
}
```

---

## Cost Estimation Implementation

### AgentCore Cost Model (Configuration-Driven)

```typescript
// convex/cost/agentcore.ts

interface AgentCoreUsage {
  computeSeconds: number;
  vCpu: number;
  memoryMb: number;
  memoryEvents: number;
  toolInvocations: number;
  codeInterpreterSeconds?: number;
  browserSeconds?: number;
}

export function estimateAgentCoreCost(usage: AgentCoreUsage): number {
  // Base runtime cost (per-second pricing)
  const computeCost = usage.computeSeconds * usage.vCpu * 0.0001;
  
  // Memory service cost
  const memoryCost = (usage.memoryEvents / 1000) * 0.25;
  
  // Gateway cost (tool invocations)
  const gatewayCost = (usage.toolInvocations / 1000) * 0.005;
  
  // Code Interpreter (included in compute time)
  // No separate charge, just additional compute seconds
  
  // Browser (included in compute time)
  // No separate charge, just additional compute seconds
  
  return computeCost + memoryCost + gatewayCost;
}

// Example usage calculation
const usage: AgentCoreUsage = {
  computeSeconds: 120,     // 2 minutes active compute
  vCpu: 2,                 // 2 vCPU config
  memoryMb: 2048,          // 2GB RAM
  memoryEvents: 50,        // Memory store operations
  toolInvocations: 5,      // LLM + tool calls
  codeInterpreterSeconds: 30, // 30s code execution (included in compute)
  browserSeconds: 45,      // 45s browser automation (included in compute)
};

const cost = estimateAgentCoreCost(usage);
console.log(`Estimated cost: $${cost.toFixed(4)}`);
// Output: Estimated cost: $0.0254
```

### Telemetry to Cost Mapping

```typescript
// convex/aggregation/costAggregation.ts

export const aggregateCosts = mutation({
  handler: async (ctx) => {
    const events = await ctx.db.query('metricsEvents')
      .filter(q => q.eq(q.field('processed'), false))
      .collect();
    
    for (const event of events) {
      let cost = 0;
      
      if (event.runtimeProvider === 'cloudflare') {
        // Cloudflare cost model
        cost = estimateCloudFlareCost({
          requests: event.requests,
          computeMs: event.computeMs,
          durableObjectOps: event.provider?.cloudflare?.durableObjectOps || 0,
          workersAICalls: event.provider?.cloudflare?.workersAICalls || 0,
        });
      } else if (event.runtimeProvider === 'agentcore') {
        // AgentCore cost model
        cost = estimateAgentCoreCost({
          computeSeconds: event.computeMs / 1000,
          vCpu: event.provider?.agentcore?.vCpu || 1,
          memoryMb: event.provider?.agentcore?.memoryMb || 2048,
          memoryEvents: event.provider?.agentcore?.memoryEvents || 0,
          toolInvocations: event.provider?.agentcore?.toolInvocations || 0,
          codeInterpreterSeconds: event.provider?.agentcore?.codeInterpreterSeconds,
          browserSeconds: event.provider?.agentcore?.browserSeconds,
        });
      }
      
      // Update billingUsage
      await updateBillingUsage(ctx, {
        userId: event.userId,
        period: getCurrentPeriod(),
        costUsdEstimated: cost,
        runtimeProvider: event.runtimeProvider,
      });
      
      // Mark event as processed
      await ctx.db.patch(event._id, { processed: true });
    }
  },
});
```

---

## Testing Requirements

### Unit Tests

```typescript
// test/adapters/agentcore.test.ts

describe('AgentCoreAdapter', () => {
  let adapter: AgentCoreAdapter;
  
  beforeEach(() => {
    adapter = new AgentCoreAdapter('us-east-1');
  });
  
  describe('deploy', () => {
    it('creates AgentCore runtime with correct configuration', async () => {
      const deployment = mockDeployment({
        providerConfig: {
          agentcore: {
            region: 'us-east-1',
            vCpu: 2,
            memoryMb: 2048,
            memoryEnabled: true,
            codeInterpreterEnabled: true,
            browserEnabled: false,
          },
        },
      });
      
      const providerRef = await adapter.deploy(deployment);
      
      expect(providerRef.agentcore).toBeDefined();
      expect(providerRef.agentcore!.agentRuntimeArn).toMatch(/^arn:aws:bedrock-agentcore/);
      expect(providerRef.agentcore!.memoryEnabled).toBe(true);
      expect(providerRef.agentcore!.codeInterpreterEnabled).toBe(true);
      expect(providerRef.agentcore!.browserEnabled).toBe(false);
    });
    
    it('injects telemetry secret and customer secrets', async () => {
      // Test that environment variables are correctly injected
      // ...
    });
  });
  
  describe('invoke', () => {
    it('maps sessionId to runtimeSessionId', async () => {
      const sessionId = 'session-123';
      const result = await adapter.invoke(mockDeployment(), {
        messages: [{ role: 'user', content: 'Hello' }],
        sessionId,
      });
      
      expect(result.sessionId).toBe(sessionId);
    });
    
    it('handles session expiration gracefully', async () => {
      // Mock expired session error
      await expect(
        adapter.invoke(mockDeployment(), {
          messages: [{ role: 'user', content: 'Hello' }],
          sessionId: 'expired-session',
        })
      ).rejects.toMatchObject({
        code: 'RUNTIME_ERROR',
        retryable: false,
      });
    });
  });
  
  describe('cost estimation', () => {
    it('calculates cost correctly for standard invocation', () => {
      const cost = estimateAgentCoreCost({
        computeSeconds: 60,
        vCpu: 1,
        memoryMb: 2048,
        memoryEvents: 10,
        toolInvocations: 3,
      });
      
      expect(cost).toBeCloseTo(0.0086, 4);
    });
    
    it('includes tool usage in cost calculation', () => {
      const costWithTools = estimateAgentCoreCost({
        computeSeconds: 120,
        vCpu: 2,
        memoryMb: 2048,
        memoryEvents: 50,
        toolInvocations: 10,
        codeInterpreterSeconds: 30,
        browserSeconds: 45,
      });
      
      expect(costWithTools).toBeGreaterThan(0.02);
    });
  });
});
```

### Integration Tests (Staging)

```typescript
// test/integration/agentcore.integration.test.ts

describe('AgentCore Integration (Staging)', () => {
  // Skip if AgentCore credentials not configured
  const skipIfNoCredentials = () => {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      return test.skip;
    }
    return test;
  };
  
  skipIfNoCredentials()('deploys and invokes TypeScript agent', async () => {
    // 1. Create agent
    const agent = await createTestAgent({
      name: 'integration-test-agent',
      runtimeProvider: 'agentcore',
      providerConfig: {
        agentcore: {
          region: 'us-east-1',
          vCpu: 1,
          memoryMb: 2048,
          memoryEnabled: true,
          codeInterpreterEnabled: false,
          browserEnabled: false,
        },
      },
    });
    
    // 2. Deploy agent
    const deployment = await deployTestAgent(agent._id, {
      artifact: {
        type: 's3',
        s3Uri: 's3://test-bucket/test-agent.zip',
      },
    });
    
    expect(deployment.status).toBe('active');
    expect(deployment.providerRef.agentcore).toBeDefined();
    
    // 3. Invoke agent
    const result = await invokeTestAgent(deployment, {
      messages: [{ role: 'user', content: 'Hello, world!' }],
    });
    
    expect(result.text).toBeTruthy();
    expect(result.sessionId).toBeTruthy();
    expect(result.usage.tokens).toBeGreaterThan(0);
    
    // 4. Cleanup
    await deleteTestAgent(agent._id);
  }, 60000); // 60s timeout
  
  skipIfNoCredentials()('invokes agent with Code Interpreter (Enterprise)', async () => {
    const agent = await createTestAgent({
      name: 'code-interpreter-test',
      runtimeProvider: 'agentcore',
      providerConfig: {
        agentcore: {
          region: 'us-east-1',
          vCpu: 2,
          memoryMb: 2048,
          memoryEnabled: true,
          codeInterpreterEnabled: true, // Enterprise feature
          browserEnabled: false,
        },
      },
    });
    
    const deployment = await deployTestAgent(agent._id, {
      artifact: getCodeInterpreterTestArtifact(),
    });
    
    const result = await invokeTestAgent(deployment, {
      messages: [{ role: 'user', content: 'Calculate fibonacci(10)' }],
    });
    
    expect(result.text).toContain('55'); // fib(10) = 55
    expect(result.usage.toolCalls).toBeGreaterThan(0);
    
    await deleteTestAgent(agent._id);
  }, 120000); // 2min timeout
});
```

### E2E Tests

```typescript
// test/e2e/agentcore.e2e.test.ts

describe('AgentCore E2E Flow', () => {
  it('complete user journey: signup -> create agent -> deploy -> invoke', async () => {
    // 1. Sign up as Enterprise user
    const user = await signupTestUser('enterprise');
    
    // 2. Create agent with AgentCore + tools
    const agent = await createAgent(user.token, {
      name: 'E2E Test Agent',
      runtimeProvider: 'agentcore',
      providerConfig: {
        agentcore: {
          memoryEnabled: true,
          codeInterpreterEnabled: true,
          browserEnabled: true,
        },
      },
    });
    
    // 3. Deploy agent
    const deployment = await deployAgent(user.token, agent.id);
    expect(deployment.status).toBe('active');
    
    // 4. Invoke agent (test memory)
    const result1 = await invokeAgent(user.token, agent.id, {
      messages: [{ role: 'user', content: 'My name is Alice' }],
    });
    expect(result1.sessionId).toBeTruthy();
    
    // 5. Invoke again (test memory retention)
    const result2 = await invokeAgent(user.token, agent.id, {
      messages: [{ role: 'user', content: 'What is my name?' }],
      sessionId: result1.sessionId, // Continue session
    });
    expect(result2.text.toLowerCase()).toContain('alice');
    
    // 6. Invoke with Code Interpreter
    const result3 = await invokeAgent(user.token, agent.id, {
      messages: [{ role: 'user', content: 'Run: import sys; print(sys.version)' }],
    });
    expect(result3.text).toContain('3.');
    
    // 7. Check usage dashboard
    const usage = await getUsage(user.token);
    expect(usage.totalRequests).toBe(3);
    expect(usage.agentcoreRequests).toBe(3);
    expect(usage.costEstimated).toBeGreaterThan(0);
    
    // 8. Cleanup
    await deleteAgent(user.token, agent.id);
    await deleteUser(user.id);
  });
});
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Hardcoding AWS Command Names

**Problem:** AWS SDK commands evolve; hardcoded names break on updates.

**Solution:** Use TypeScript imports and pin SDK versions.

```typescript
// ❌ Bad
await client.send({ command: 'CreateAgentRuntime', ...params });

// ✅ Good
import { CreateAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
await client.send(new CreateAgentRuntimeCommand(params));
```

### Pitfall 2: Forgetting Session ID Mapping

**Problem:** Treating AgentCore `runtimeSessionId` as the same as webhost.systems `sessionId`.

**Solution:** Always map explicitly in adapter.

```typescript
// ✅ Correct mapping
async invoke(deployment, input) {
  const runtimeSessionId = input.sessionId || generateNewSessionId();
  
  const command = new InvokeAgentRuntimeCommand({
    runtimeSessionId, // AgentCore session ID
    // ...
  });
  
  const response = await this.client.send(command);
  
  return {
    sessionId: runtimeSessionId, // Return same opaque ID
    // ...
  };
}
```

### Pitfall 3: Not Handling Async Telemetry

**Problem:** Waiting for telemetry submission blocks invocation response.

**Solution:** Fire-and-forget telemetry with retry.

```typescript
// ✅ Non-blocking telemetry
async invoke(deployment, input) {
  const startTime = Date.now();
  
  try {
    const response = await this.invokeProvider(deployment, input);
    
    // Fire telemetry asynchronously (don't await)
    this.emitTelemetry({
      deploymentId: deployment._id,
      computeMs: Date.now() - startTime,
      // ...
    }).catch(err => {
      console.error('Telemetry emission failed:', err);
      // Retry in background
      this.retryTelemetry(...);
    });
    
    return response;
  } catch (error) {
    // Emit error telemetry
    this.emitTelemetry({ error: true, ... });
    throw error;
  }
}
```

### Pitfall 4: Missing Resource Cleanup

**Problem:** Orphaned AgentCore runtimes accumulate costs.

**Solution:** Tag resources and implement cleanup job.

```typescript
// Scheduled cleanup job
export const cleanupOrphanedRuntimes = internalMutation({
  handler: async (ctx) => {
    // 1. Find deleted deployments with AgentCore providerRef
    const deletedDeployments = await ctx.db.query('deployments')
      .filter(q => q.eq(q.field('deleted'), true))
      .filter(q => q.neq(q.field('providerRef.agentcore'), null))
      .collect();
    
    // 2. Delete AgentCore runtimes
    const adapter = new AgentCoreAdapter();
    
    for (const deployment of deletedDeployments) {
      try {
        await adapter.delete(deployment);
        console.log(`Cleaned up runtime: ${deployment.providerRef.agentcore.agentRuntimeArn}`);
      } catch (error) {
        console.error(`Cleanup failed for ${deployment._id}:`, error);
      }
    }
  },
});

// Schedule: Run daily
```

### Pitfall 5: Incorrect Cost Attribution

**Problem:** Telemetry doesn't include tool-specific usage metrics.

**Solution:** Capture detailed provider-specific counters.

```typescript
// ✅ Detailed telemetry
interface AgentCoreTelemetry {
  deploymentId: string;
  computeMs: number;
  vCpu: number;
  memoryMb: number;
  
  // Service-specific counters
  memoryEvents: number;
  toolInvocations: number;
  
  // Tool usage (if enabled)
  codeInterpreterCalls?: number;
  codeInterpreterSeconds?: number;
  browserSessions?: number;
  browserSeconds?: number;
}
```

---

## Appendix: Quick Reference

### SDK Documentation Links

- **@aws-sdk/client-bedrock-agentcore:** https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-agentcore/
- **bedrock-agentcore (Tools):** https://www.npmjs.com/package/bedrock-agentcore
- **Vercel AI SDK v6:** https://sdk.vercel.ai/docs
- **AgentCore Service Docs:** https://docs.aws.amazon.com/bedrock-agentcore/

### Environment Variables

```bash
# Required for AgentCore adapter
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key-id
AWS_SECRET_ACCESS_KEY=your-secret-key
AGENT_ARTIFACTS_BUCKET=your-s3-bucket

# Optional
AGENTCORE_DEFAULT_VCPU=1
AGENTCORE_DEFAULT_MEMORY_MB=2048
AGENTCORE_DEFAULT_TIMEOUT_SECONDS=900
```

### CLI Commands (Testing)

```bash
# Deploy test agent to AgentCore
npm run deploy:test -- --runtime agentcore

# Invoke test agent
npm run invoke:test -- --agent-id abc123 --message "Hello"

# Check AgentCore runtimes
aws bedrock-agentcore list-agent-runtimes --region us-east-1

# Delete orphaned runtime
aws bedrock-agentcore delete-agent-runtime \
  --agent-runtime-arn arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-runtime
```

---

## Conclusion

This guide provides everything needed to implement AgentCore TypeScript support in webhost.systems:

✅ **SDK versions and installation**  
✅ **Runtime capability matrix**  
✅ **Complete adapter implementation**  
✅ **Deployment artifact format**  
✅ **Tool enablement strategy**  
✅ **Tier entitlements and gating**  
✅ **Cost estimation implementation**  
✅ **Comprehensive testing requirements**  
✅ **Common pitfalls and solutions**

**Next Steps:**
1. Review and approve tool enablement strategy (Enterprise-only vs Pro-tier)
2. Set up AWS staging environment with AgentCore access
3. Implement adapter following the code examples
4. Write tests per testing requirements
5. Deploy to staging and validate end-to-end

**Questions or Issues:** Reference the spec_v1 ADRs for architectural decisions and this guide for implementation details.

---

**Document Version:** 1.0  
**Last Updated:** January 21, 2026  
**Maintained By:** webhost.systems engineering team
