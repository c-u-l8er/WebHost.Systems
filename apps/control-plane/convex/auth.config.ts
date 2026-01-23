import type { AuthConfig } from "convex/server";

/**
 * Convex Auth configuration for Clerk.
 *
 * You must create a Clerk JWT template with `aud` / application ID set to "convex",
 * then provide the issuer domain via:
 *   CLERK_JWT_ISSUER_DOMAIN
 *
 * Set the same env var in the Convex Dashboard for deployed environments.
 */
const clerkIssuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!clerkIssuerDomain) {
  throw new Error(
    "Missing CLERK_JWT_ISSUER_DOMAIN. Configure your Clerk JWT issuer domain for Convex auth."
  );
}

export default {
  providers: [
    {
      domain: clerkIssuerDomain,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
