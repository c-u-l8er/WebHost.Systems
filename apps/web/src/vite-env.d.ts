/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (from `supabase start` or hosted dashboard). */
  readonly VITE_SUPABASE_URL: string;

  /** Supabase anon/publishable key. */
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
