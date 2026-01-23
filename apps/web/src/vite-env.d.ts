/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Clerk publishable key for Vite client builds.
   * Set this in `.env.local` (preferred) or `.env`.
   */
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;

  /**
   * Control plane base URL (optional convenience).
   * Example: https://<your-deployment>.convex.site
   */
  readonly VITE_CONTROL_PLANE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
