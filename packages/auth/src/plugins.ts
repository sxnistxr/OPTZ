// Server-only extensions. Enable deliberately; migrate whenever the plugin schema changes.
export { organization, admin, genericOAuth, multiSession } from "better-auth/plugins";
export type { BetterAuthPlugin, BetterAuthOptions } from "better-auth";
