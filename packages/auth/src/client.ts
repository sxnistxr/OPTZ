// Browser-safe entry: select only the plugins your UI needs; no server/database dependency.
export { createAuthClient } from "better-auth/client";
export { passkeyClient } from "@better-auth/passkey/client";
export { twoFactorClient, emailOTPClient, magicLinkClient, phoneNumberClient, usernameClient, organizationClient, adminClient, multiSessionClient } from "better-auth/client/plugins";
