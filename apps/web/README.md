# webhost.systems — Dashboard (Vite + React + Clerk)

This is the **webhost.systems dashboard** app (greenfield) built with **Vite + React + TypeScript** and **Clerk** for authentication.

Clerk React quickstart: https://clerk.com/docs/quickstarts/react

The dashboard is intended to talk to the **control plane** (Convex HTTP API) implemented in `WebHost.Systems/apps/control-plane`.

---

## Prerequisites

- Node.js **20+**
- A Clerk application

---

## Install

From repo root:

```/dev/null/sh#L1-1
npm --prefix WebHost.Systems/apps/web install
```

---

## Environment variables

Create `WebHost.Systems/apps/web/.env.local` (preferred for local development).

### Required

```/dev/null/.env.local#L1-1
VITE_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

### Optional (recommended for Slice B)

Select which Clerk JWT template name the dashboard requests when authenticating to the control plane:

```/dev/null/.env.local#L1-1
VITE_CLERK_JWT_TEMPLATE=convex
```

If omitted, the dashboard defaults to requesting the `convex` template.

Point the dashboard at your control plane base URL (Convex HTTP endpoint domain):

```/dev/null/.env.local#L1-2
VITE_CONTROL_PLANE_URL=https://YOUR_CONVEX_DEPLOYMENT.convex.site
```

Notes:
- The `VITE_` prefix is required for Vite to expose env vars to client code.
- Use placeholder values in tracked files; put real keys only in `.env.local`.

---

## Clerk integration (what to look for)

- `VITE_CLERK_PUBLISHABLE_KEY` is read from `import.meta.env`
- The app is wrapped with `<ClerkProvider publishableKey={...}>` in `src/main.tsx`
- The UI uses Clerk components:
  - `<SignedIn>`, `<SignedOut>`, `<SignInButton>`, `<SignUpButton>`, `<UserButton>`

---

## Run locally

```/dev/null/sh#L1-3
cd WebHost.Systems/apps/web
npm run dev
```

Vite will print the local URL (default is `http://localhost:5173`).

---

## How auth is used for the control plane

The dashboard calls control plane endpoints using an `Authorization: Bearer <JWT>` header.

In the current UI, the token is retrieved from Clerk using:

- `useAuth().getToken({ template: import.meta.env.VITE_CLERK_JWT_TEMPLATE ?? "convex" })`

You must ensure:
- You have a Clerk JWT template named whatever `VITE_CLERK_JWT_TEMPLATE` is set to (defaults to `convex`), and
- The control plane (Convex) is configured to accept that JWT (see `apps/control-plane/convex/auth.config.ts`).

---

## Slice B supported UI flows

From the dashboard you can:
1. Create an agent
2. Deploy the agent (Cloudflare, using the control plane’s built-in Worker template if you omit `moduleCode`)
3. Invoke the agent (non-streaming)
4. Invoke via SSE stream endpoint (currently emulated by buffering one response and emitting `meta/delta/usage/done`)

---

## Troubleshooting

### “Missing Clerk Publishable Key”
- Set `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env.local`
- Restart `npm run dev`

### Control plane requests failing
- Ensure `VITE_CONTROL_PLANE_URL` is correct (no trailing slash required)
- Ensure you are signed in (Clerk)
- Ensure the Clerk JWT template named by `VITE_CLERK_JWT_TEMPLATE` (defaults to `convex`) exists and matches the Convex auth configuration

---
