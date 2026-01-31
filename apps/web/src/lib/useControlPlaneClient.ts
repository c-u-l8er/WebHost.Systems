import { useAuth } from "@clerk/clerk-react";
import { useMemo } from "react";
import { ControlPlaneClient } from "./controlPlaneClient";

export type UseControlPlaneClientOptions = {
  /**
   * Override the control-plane base URL.
   * If omitted, uses `import.meta.env.VITE_CONTROL_PLANE_URL`.
   */
  baseUrl?: string;

  /**
   * Override the Clerk JWT template name.
   * If omitted, uses `import.meta.env.VITE_CLERK_JWT_TEMPLATE`, falling back to "convex".
   *
   * Special value:
   * - "default": call `getToken()` with no template.
   */
  jwtTemplate?: string;

  /**
   * Optional default fetch init overrides (passed through to the client).
   */
  defaultFetchInit?: RequestInit;
};

export type UseControlPlaneClientResult = {
  /**
   * A ready-to-use authenticated client, or null if misconfigured (no base URL).
   */
  client: ControlPlaneClient | null;

  /**
   * Normalized base URL used for the client (no trailing slash), or "" if unset.
   */
  controlPlaneUrl: string;

  /**
   * Resolved Clerk JWT template name ("convex" default).
   */
  clerkJwtTemplate: string;

  /**
   * Convenience boolean: true when `client` is non-null.
   */
  canUseApi: boolean;
};

function normalizeBaseUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s ? s.replace(/\/+$/, "") : "";
}

function resolveJwtTemplate(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s ? s : "convex";
}

/**
 * Shared hook for constructing an authenticated `ControlPlaneClient`.
 *
 * This centralizes:
 * - base URL normalization (`VITE_CONTROL_PLANE_URL`)
 * - Clerk JWT template selection (`VITE_CLERK_JWT_TEMPLATE`, default "convex")
 * - consistent, actionable error message when Clerk token fetch fails
 *
 * Intended usage:
 * - Dashboard / Agents / Account pages should call this hook instead of duplicating client creation.
 */
export function useControlPlaneClient(
  options: UseControlPlaneClientOptions = {},
): UseControlPlaneClientResult {
  const { getToken } = useAuth();

  const controlPlaneUrl = useMemo(() => {
    const envUrl =
      (import.meta as any).env?.VITE_CONTROL_PLANE_URL ??
      (import.meta as any).env?.VITE_CONTROL_PLANE ??
      (import.meta as any).env?.VITE_CONVEX_HTTP_URL ??
      (import.meta as any).env?.VITE_CONTROL_PLANE_HTTP_URL ??
      (import.meta as any).env?.VITE_CONTROL_PLANE_BASE_URL ??
      // Standard expected key:
      (import.meta as any).env?.VITE_CONTROL_PLANE_URL;

    return normalizeBaseUrl(options.baseUrl ?? envUrl);
  }, [options.baseUrl]);

  const clerkJwtTemplate = useMemo(() => {
    const envTemplate = (import.meta as any).env?.VITE_CLERK_JWT_TEMPLATE;
    return resolveJwtTemplate(options.jwtTemplate ?? envTemplate);
  }, [options.jwtTemplate]);

  const client = useMemo(() => {
    if (!controlPlaneUrl) return null;

    return new ControlPlaneClient({
      baseUrl: controlPlaneUrl,
      defaultFetchInit: options.defaultFetchInit,
      getToken: async () => {
        try {
          if (clerkJwtTemplate === "default") {
            return await getToken();
          }
          return await getToken({ template: clerkJwtTemplate });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Failed to fetch Clerk JWT (template "${clerkJwtTemplate}"). ` +
              `If you see a 404 to /tokens/${clerkJwtTemplate}, create a Clerk JWT template named "${clerkJwtTemplate}" ` +
              `with audience/application ID "convex", or set VITE_CLERK_JWT_TEMPLATE to an existing template name. ` +
              `Underlying error: ${detail}`,
          );
        }
      },
    });
  }, [controlPlaneUrl, options.defaultFetchInit, getToken, clerkJwtTemplate]);

  return {
    client,
    controlPlaneUrl,
    clerkJwtTemplate,
    canUseApi: !!client,
  };
}

export default useControlPlaneClient;
