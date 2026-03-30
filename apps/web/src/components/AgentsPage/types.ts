import type {
  Agent,
  BillingUsage,
  Deployment,
  InvokeV1Response,
  MetricsEvent,
} from "../../lib/supabaseApi";

export type RuntimeProvider = "cloudflare" | "agentcore" | "openrouter";

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export type AgentsPageMode = "list" | "detail" | "combined";

export type AgentSortKey =
  | "name"
  | "status"
  | "runtime_provider"
  | "hasActiveDeployment"
  | "updated_at"
  | "created_at"
  | "id";

export type SortDir = "asc" | "desc";

export type AgentsPageProps = {
  mode?: AgentsPageMode;
  agentId?: string;
  onNavigateToAgent?: (agentId: string) => void;
  onBackToList?: () => void;
};

export type {
  Agent,
  BillingUsage,
  Deployment,
  InvokeV1Response,
  MetricsEvent,
};
