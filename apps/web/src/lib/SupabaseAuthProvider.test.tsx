import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// ---- Supabase auth mock ----
const mockGetSession = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockSignOut = vi.fn();

let authChangeCallback: ((event: string, session: any) => void) | null = null;
const mockUnsubscribe = vi.fn();

const mockOnAuthStateChange = vi.fn().mockImplementation((cb: any) => {
  authChangeCallback = cb;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
      onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
      signUp: (...args: any[]) => mockSignUp(...args),
      signInWithOAuth: (...args: any[]) => mockSignInWithOAuth(...args),
      signOut: (...args: any[]) => mockSignOut(...args),
    },
  },
}));

import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "./SupabaseAuthProvider";

// Test consumer component
function AuthConsumer() {
  const { session, user, loading, signIn, signUp, signInWithOAuth, signOut } =
    useSupabaseAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user-id">{user?.id ?? "none"}</span>
      <span data-testid="session">{session ? "active" : "none"}</span>
      <button onClick={() => signIn("a@b.com", "pass")}>sign-in</button>
      <button onClick={() => signUp("a@b.com", "pass")}>sign-up</button>
      <button onClick={() => signInWithOAuth("github")}>oauth</button>
      <button onClick={() => signOut()}>sign-out</button>
    </div>
  );
}

describe("SupabaseAuthProvider", () => {
  const fakeSession = {
    access_token: "tok",
    user: { id: "u1", email: "a@b.com" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authChangeCallback = null;
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it("starts in loading state then resolves to no session", async () => {
    render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    // Should resolve to not loading
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user-id").textContent).toBe("none");
    expect(screen.getByTestId("session").textContent).toBe("none");
  });

  it("resolves existing session on mount", async () => {
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } });

    render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user-id").textContent).toBe("u1");
    expect(screen.getByTestId("session").textContent).toBe("active");
  });

  it("subscribes to auth state changes and unsubscribes on unmount", async () => {
    const { unmount } = render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("updates session when onAuthStateChange fires", async () => {
    render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("session").textContent).toBe("none");

    // Simulate auth state change
    await act(async () => {
      authChangeCallback?.("SIGNED_IN", fakeSession);
    });

    expect(screen.getByTestId("user-id").textContent).toBe("u1");
    expect(screen.getByTestId("session").textContent).toBe("active");
  });

  it("signIn calls supabase.auth.signInWithPassword", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await userEvent.click(screen.getByText("sign-in"));

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "pass",
    });
  });

  it("signIn throws when supabase returns error", async () => {
    const authError = { message: "Invalid credentials" };
    mockSignInWithPassword.mockResolvedValue({ error: authError });

    // Create a consumer that captures thrown errors
    let thrownError: any = null;
    function ErrorCapture() {
      const { signIn } = useSupabaseAuth();
      return (
        <button
          data-testid="sign-in-throw"
          onClick={async () => {
            try {
              await signIn("bad@test.com", "wrong");
            } catch (e) {
              thrownError = e;
            }
          }}
        >
          try-sign-in
        </button>
      );
    }

    render(
      <SupabaseAuthProvider>
        <ErrorCapture />
      </SupabaseAuthProvider>,
    );

    await userEvent.click(screen.getByTestId("sign-in-throw"));

    await waitFor(() => {
      expect(thrownError).toBeTruthy();
      expect(thrownError.message).toBe("Invalid credentials");
    });
  });

  it("signUp calls supabase.auth.signUp", async () => {
    mockSignUp.mockResolvedValue({ error: null });

    render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await userEvent.click(screen.getByText("sign-up"));

    expect(mockSignUp).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "pass",
    });
  });

  it("signInWithOAuth calls supabase.auth.signInWithOAuth", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });

    render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await userEvent.click(screen.getByText("oauth"));

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({ provider: "github" });
  });

  it("signOut calls supabase.auth.signOut", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } });

    render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("session").textContent).toBe("active");
    });

    await userEvent.click(screen.getByText("sign-out"));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("user is derived from session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } });

    render(
      <SupabaseAuthProvider>
        <AuthConsumer />
      </SupabaseAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-id").textContent).toBe("u1");
    });

    // Simulate sign-out via auth state change
    await act(async () => {
      authChangeCallback?.("SIGNED_OUT", null);
    });

    expect(screen.getByTestId("user-id").textContent).toBe("none");
  });
});

describe("useSupabaseAuth", () => {
  it("throws when used outside provider", () => {
    // Suppress error boundary noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Orphan() {
      useSupabaseAuth();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(
      "useSupabaseAuth must be used within a <SupabaseAuthProvider>",
    );

    spy.mockRestore();
  });
});
