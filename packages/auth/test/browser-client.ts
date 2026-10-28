import { createAuthClient, passkeyClient } from "../src/client";
(window as unknown as { auth: unknown }).auth = createAuthClient({ baseURL: window.location.origin, plugins: [passkeyClient()] });
