import { createAuthClient, passkeyClient, twoFactorClient, emailOTPClient, magicLinkClient, phoneNumberClient, usernameClient } from "@optz/auth/client";
export const client = createAuthClient({ plugins: [passkeyClient(), twoFactorClient(), emailOTPClient(), magicLinkClient(), phoneNumberClient(), usernameClient()] });
