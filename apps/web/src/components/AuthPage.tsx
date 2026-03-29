/**
 * Auth pages — login, signup, callback, reset-password, update-password.
 *
 * Modeled after BendScript's /auth/ routes:
 * - Dedicated pages (not inline forms on the landing page)
 * - redirectTo param support for post-auth navigation
 * - OAuth callback handling
 * - Magic link / password auth
 */

import React, { useCallback, useEffect, useState } from "react";
import { useSupabaseAuth } from "../lib/SupabaseAuthProvider";
import { supabase } from "../lib/supabaseClient";

export type AuthMode = "login" | "signup" | "callback" | "reset-password" | "update-password";

export type AuthPageProps = {
  mode: AuthMode;
  redirectTo?: string;
  onNavigate: (page: string, params?: Record<string, string>) => void;
};

export default function AuthPage({
  mode,
  redirectTo,
  onNavigate,
}: AuthPageProps): React.ReactElement {
  switch (mode) {
    case "login":
      return <LoginPage redirectTo={redirectTo} onNavigate={onNavigate} />;
    case "signup":
      return <SignupPage redirectTo={redirectTo} onNavigate={onNavigate} />;
    case "callback":
      return <CallbackPage redirectTo={redirectTo} onNavigate={onNavigate} />;
    case "reset-password":
      return <ResetPasswordPage onNavigate={onNavigate} />;
    case "update-password":
      return <UpdatePasswordPage onNavigate={onNavigate} />;
    default:
      return <LoginPage redirectTo={redirectTo} onNavigate={onNavigate} />;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function LoginPage({
  redirectTo,
  onNavigate,
}: {
  redirectTo?: string;
  onNavigate: AuthPageProps["onNavigate"];
}): React.ReactElement {
  const { user } = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // If already signed in, redirect
  useEffect(() => {
    if (user) {
      onNavigate(redirectTo || "dashboard");
    }
  }, [user, redirectTo, onNavigate]);

  const handlePasswordLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const { error: authErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (authErr) throw authErr;
        // onAuthStateChange will trigger redirect via user effect above
      } catch (err: any) {
        setError(err.message ?? "Sign in failed");
      } finally {
        setSubmitting(false);
      }
    },
    [email, password],
  );

  const handleMagicLink = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const callbackUrl = buildCallbackUrl(redirectTo);
      const { error: authErr } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callbackUrl },
      });
      if (authErr) throw authErr;
      setMagicLinkSent(true);
    } catch (err: any) {
      setError(err.message ?? "Failed to send magic link");
    } finally {
      setSubmitting(false);
    }
  }, [email, redirectTo]);

  const handleGoogleLogin = useCallback(async () => {
    setError(null);
    try {
      const callbackUrl = buildCallbackUrl(redirectTo);
      const { error: authErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl },
      });
      if (authErr) throw authErr;
    } catch (err: any) {
      setError(err.message ?? "Google sign in failed");
    }
  }, [redirectTo]);

  const handleGithubLogin = useCallback(async () => {
    setError(null);
    try {
      const callbackUrl = buildCallbackUrl(redirectTo);
      const { error: authErr } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: callbackUrl },
      });
      if (authErr) throw authErr;
    } catch (err: any) {
      setError(err.message ?? "GitHub sign in failed");
    }
  }, [redirectTo]);

  if (magicLinkSent) {
    return (
      <AuthShell title="Check your email">
        <div style={{ textAlign: "center" }}>
          <p>We sent a magic link to <strong>{email}</strong></p>
          <p className="muted" style={{ fontSize: 13 }}>
            Click the link in the email to sign in. If you don't see it, check your spam folder.
          </p>
          {isLocalDev() ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Local dev: check{" "}
              <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
                Mailpit (port 54324)
              </a>{" "}
              for the email.
            </p>
          ) : null}
          <button
            className="button"
            type="button"
            onClick={() => setMagicLinkSent(false)}
            style={{ marginTop: 12 }}
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in to WebHost.Systems">
      <form onSubmit={handlePasswordLogin} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="email"
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={inputStyle}
        />

        {error ? <div style={errorStyle}>{error}</div> : null}

        <button
          className="button button-primary"
          type="submit"
          disabled={submitting}
          style={{ width: "100%", padding: "8px 0" }}
        >
          {submitting ? "Signing in..." : "Sign in with password"}
        </button>

        <div style={dividerStyle}>
          <span className="muted" style={{ fontSize: 12 }}>or</span>
        </div>

        <button
          className="button"
          type="button"
          disabled={submitting || !email}
          onClick={handleMagicLink}
          style={{ width: "100%" }}
        >
          Send magic link
        </button>

        <div style={dividerStyle}>
          <span className="muted" style={{ fontSize: 12 }}>or continue with</span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="button"
            type="button"
            onClick={handleGithubLogin}
            style={{ flex: 1 }}
          >
            GitHub
          </button>
          <button
            className="button"
            type="button"
            onClick={handleGoogleLogin}
            style={{ flex: 1 }}
          >
            Google
          </button>
        </div>
      </form>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="button"
          style={{ fontSize: 12, border: "none", background: "none", cursor: "pointer" }}
          onClick={() => onNavigate("signup", redirectTo ? { redirectTo } : undefined)}
        >
          Don't have an account? <strong>Sign up</strong>
        </button>
        <button
          type="button"
          className="button"
          style={{ fontSize: 12, border: "none", background: "none", cursor: "pointer" }}
          onClick={() => onNavigate("reset-password")}
        >
          Forgot password?
        </button>
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

function SignupPage({
  redirectTo,
  onNavigate,
}: {
  redirectTo?: string;
  onNavigate: AuthPageProps["onNavigate"];
}): React.ReactElement {
  const { user } = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  useEffect(() => {
    if (user) {
      onNavigate(redirectTo || "dashboard");
    }
  }, [user, redirectTo, onNavigate]);

  const handleSignup = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const callbackUrl = buildCallbackUrl(redirectTo);
        const { error: authErr } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callbackUrl },
        });
        if (authErr) throw authErr;
        setConfirmSent(true);
      } catch (err: any) {
        setError(err.message ?? "Sign up failed");
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, redirectTo],
  );

  if (confirmSent) {
    return (
      <AuthShell title="Check your email">
        <div style={{ textAlign: "center" }}>
          <p>We sent a confirmation link to <strong>{email}</strong></p>
          <p className="muted" style={{ fontSize: 13 }}>
            Click the link to verify your email and complete sign up.
          </p>
          {isLocalDev() ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Local dev: check{" "}
              <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
                Mailpit (port 54324)
              </a>{" "}
              for the email.
            </p>
          ) : null}
          <button
            className="button"
            type="button"
            onClick={() => onNavigate("login", redirectTo ? { redirectTo } : undefined)}
            style={{ marginTop: 12 }}
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create an account">
      <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="email"
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
          style={inputStyle}
        />

        {error ? <div style={errorStyle}>{error}</div> : null}

        <button
          className="button button-primary"
          type="submit"
          disabled={submitting}
          style={{ width: "100%", padding: "8px 0" }}
        >
          {submitting ? "Creating account..." : "Create account"}
        </button>
      </form>

      <div style={{ marginTop: 16, textAlign: "center" }}>
        <button
          type="button"
          className="button"
          style={{ fontSize: 12, border: "none", background: "none", cursor: "pointer" }}
          onClick={() => onNavigate("login", redirectTo ? { redirectTo } : undefined)}
        >
          Already have an account? <strong>Sign in</strong>
        </button>
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Callback (OAuth / magic link redirect handler)
// ---------------------------------------------------------------------------

function CallbackPage({
  redirectTo,
  onNavigate,
}: {
  redirectTo?: string;
  onNavigate: AuthPageProps["onNavigate"];
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Supabase client auto-detects the auth tokens from URL hash/params
        const { error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) {
          throw sessionErr;
        }

        // Check for error in URL params (OAuth failure)
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const urlError = params.get("error") || hashParams.get("error");
        const urlErrorDesc = params.get("error_description") || hashParams.get("error_description");

        if (urlError) {
          throw new Error(urlErrorDesc || urlError);
        }

        // Exchange code for session if present (OAuth PKCE flow)
        const code = params.get("code");
        if (code) {
          const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeErr) throw exchangeErr;
        }

        // Redirect to target page
        const target = redirectTo || params.get("redirectTo") || "dashboard";
        // Prevent open redirect — only allow relative paths
        const safePath = target.startsWith("/") && !target.startsWith("//") ? target : "dashboard";
        onNavigate(safePath);
      } catch (err: any) {
        setError(err.message ?? "Authentication callback failed");
      }
    };

    handleCallback();
  }, [redirectTo, onNavigate]);

  if (error) {
    return (
      <AuthShell title="Authentication failed">
        <div style={{ textAlign: "center" }}>
          <div style={errorStyle}>{error}</div>
          <button
            className="button"
            type="button"
            onClick={() => onNavigate("login")}
            style={{ marginTop: 12 }}
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Completing sign in...">
      <div style={{ textAlign: "center" }}>
        <div className="muted">Verifying authentication...</div>
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

function ResetPasswordPage({
  onNavigate,
}: {
  onNavigate: AuthPageProps["onNavigate"];
}): React.ReactElement {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleReset = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const callbackUrl = buildCallbackUrl("update-password");
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: callbackUrl,
        });
        if (resetErr) throw resetErr;
        setSubmitted(true);
      } catch (err: any) {
        setError(err.message ?? "Failed to send reset email");
      } finally {
        setSubmitting(false);
      }
    },
    [email],
  );

  if (submitted) {
    return (
      <AuthShell title="Check your email">
        <div style={{ textAlign: "center" }}>
          <p>We sent a password reset link to <strong>{email}</strong></p>
          <p className="muted" style={{ fontSize: 13 }}>
            Click the link to set a new password.
          </p>
          {isLocalDev() ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Local dev: check{" "}
              <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
                Mailpit (port 54324)
              </a>
            </p>
          ) : null}
          <button
            className="button"
            type="button"
            onClick={() => onNavigate("login")}
            style={{ marginTop: 12 }}
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password">
      <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="email"
          style={inputStyle}
        />

        {error ? <div style={errorStyle}>{error}</div> : null}

        <button
          className="button button-primary"
          type="submit"
          disabled={submitting}
          style={{ width: "100%", padding: "8px 0" }}
        >
          {submitting ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <div style={{ marginTop: 16, textAlign: "center" }}>
        <button
          type="button"
          className="button"
          style={{ fontSize: 12, border: "none", background: "none", cursor: "pointer" }}
          onClick={() => onNavigate("login")}
        >
          Back to sign in
        </button>
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Update password (after reset link clicked)
// ---------------------------------------------------------------------------

function UpdatePasswordPage({
  onNavigate,
}: {
  onNavigate: AuthPageProps["onNavigate"];
}): React.ReactElement {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const { error: updateErr } = await supabase.auth.updateUser({ password });
        if (updateErr) throw updateErr;
        setSuccess(true);
      } catch (err: any) {
        setError(err.message ?? "Failed to update password");
      } finally {
        setSubmitting(false);
      }
    },
    [password],
  );

  if (success) {
    return (
      <AuthShell title="Password updated">
        <div style={{ textAlign: "center" }}>
          <p>Your password has been updated.</p>
          <button
            className="button button-primary"
            type="button"
            onClick={() => onNavigate("dashboard")}
            style={{ marginTop: 12 }}
          >
            Go to dashboard
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password">
      <form onSubmit={handleUpdate} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="password"
          placeholder="New password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoFocus
          autoComplete="new-password"
          style={inputStyle}
        />

        {error ? <div style={errorStyle}>{error}</div> : null}

        <button
          className="button button-primary"
          type="submit"
          disabled={submitting}
          style={{ width: "100%", padding: "8px 0" }}
        >
          {submitting ? "Updating..." : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Shared layout shell
// ---------------------------------------------------------------------------

function AuthShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <a
            href="/"
            style={{ textDecoration: "none", color: "inherit" }}
            onClick={(e) => { e.preventDefault(); window.location.href = "/"; }}
          >
            <div className="brand-title" style={{ fontSize: 16 }}>
              WebHost.Systems
            </div>
          </a>
          <div className="brand-subtitle" style={{ marginTop: 4 }}>
            AI Systems for Web Hosts
          </div>
        </div>

        <div
          className="panel"
          style={{
            padding: 20,
            background: "var(--panel)",
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: 18, textAlign: "center" }}>
            {title}
          </h2>
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCallbackUrl(redirectTo?: string): string {
  const base = window.location.origin;
  const params = new URLSearchParams();
  params.set("page", "callback");
  if (redirectTo) params.set("redirectTo", redirectTo);
  return `${base}/?${params.toString()}`;
}

function isLocalDev(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  borderRadius: 6,
  border: "1px solid var(--border, #333)",
  background: "var(--bg, #111)",
  color: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

const errorStyle: React.CSSProperties = {
  color: "var(--danger, #f66)",
  fontSize: 13,
  padding: "6px 10px",
  borderRadius: 6,
  background: "rgba(255, 100, 100, 0.08)",
  border: "1px solid rgba(255, 100, 100, 0.3)",
};

const dividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "4px 0",
};
