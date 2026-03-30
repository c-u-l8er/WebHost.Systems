/**
 * Workspace provider — resolves the active workspace for the current user.
 *
 * On first login, auto-creates a personal workspace via the ensure_user_workspace RPC.
 * Stores the active workspace_id in context for use by supabaseApi and components.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { supabase } from "./supabaseClient";
import { useSupabaseAuth } from "./SupabaseAuthProvider";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
};

export type WorkspaceContextValue = {
  /** The currently active workspace, null while loading or if none exists. */
  workspace: Workspace | null;
  /** All workspaces the user is a member of. */
  workspaces: Workspace[];
  /** True while workspaces are being loaded. */
  loading: boolean;
  /** Error message if workspace resolution failed. */
  error: string | null;
  /** Switch the active workspace. */
  setActiveWorkspace: (workspaceId: string) => void;
  /** Force-refresh workspace list. */
  refresh: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { user } = useSupabaseAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setActiveId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Ensure user has at least a personal workspace
      const { error: rpcError } = await supabase.rpc("ensure_user_workspace");
      if (rpcError) throw rpcError;

      // Load all workspaces the user is a member of
      // Note: amp core tables live in `public` on hosted Supabase
      const { data, error: queryError } = await supabase
        .from("workspace_members")
        .select("workspace:workspaces(id, name, slug, plan, created_at)")
        .eq("user_id", user.id);

      if (queryError) throw queryError;

      const ws: Workspace[] = (data ?? [])
        .map((row: any) => row.workspace)
        .filter(Boolean);

      setWorkspaces(ws);

      // Restore active workspace from localStorage or pick the first one
      const storedId = localStorage.getItem("wh:activeWorkspaceId");
      const match = ws.find((w) => w.id === storedId);
      const active = match ?? ws[0] ?? null;
      setActiveId(active?.id ?? null);
    } catch (err: any) {
      setError(err.message ?? "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const setActiveWorkspace = useCallback(
    (workspaceId: string) => {
      setActiveId(workspaceId);
      localStorage.setItem("wh:activeWorkspaceId", workspaceId);
    },
    [],
  );

  const workspace = workspaces.find((w) => w.id === activeId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        workspaces,
        loading,
        error,
        setActiveWorkspace,
        refresh: loadWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a <WorkspaceProvider>");
  }
  return ctx;
}
