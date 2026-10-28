import { twoFactor } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth";

export type FactorOptions = Parameters<typeof twoFactor>[0];

/** Reuse upstream's pending challenge, revocation and attempt tracking for every sign-in. */
export function allMethodsTwoFactor(options: FactorOptions) {
  const plugin = twoFactor(options);
  // This is a deliberately small extension of the pinned upstream plugin. A dependency upgrade
  // must run the passwordless, OAuth and passkey MFA tests before this contract can change.
  if (plugin.hooks.after.length !== 1) throw new Error("Unsupported two-factor plugin contract");
  const challenge = plugin.hooks.after[0];
  return {
    ...plugin,
    hooks: { after: [{
      ...challenge,
      matcher(ctx) {
        return challenge.matcher(ctx) || ctx.path?.startsWith("/sign-in/") ||
          ctx.path?.startsWith("/callback/") || ctx.path?.startsWith("/oauth2/callback/") ||
          ctx.path === "/magic-link/verify" || ctx.path === "/phone-number/verify" ||
          ctx.path === "/passkey/verify-authentication";
      },
    }] },
  } satisfies BetterAuthPlugin;
}
