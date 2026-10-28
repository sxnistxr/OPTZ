import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP, magicLink, phoneNumber, username } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { createHmac } from "node:crypto";
import { allMethodsTwoFactor } from "./mfa";
import { boundedRequest, memoryBudget, privateResponse, type RequestBudget } from "./transport";
import type { SendEmail, SendSMS } from "./delivery";

export type { SendEmail, SendSMS, EmailMessage, SMSMessage } from "./delivery";
export type { RequestBudget } from "./transport";
export { memoryBudget } from "./transport";

export interface AuthOptions<P extends BetterAuthPlugin[] = BetterAuthPlugin[]> {
  database: NonNullable<BetterAuthOptions["database"]>;
  /** At least 32 random bytes encoded as base64url or hex; persist outside the repository. */
  secret: string;
  /** Exact public origin. Never derive from caller-supplied forwarding headers. */
  baseURL: string;
  basePath?: string;
  appName?: string;
  allowInsecureLocalhost?: boolean;
  socialProviders?: BetterAuthOptions["socialProviders"];
  /** Enables verified password auth, email codes, magic links and password recovery. */
  email?: { send: SendEmail; password?: boolean; otp?: boolean; magicLink?: boolean };
  phone?: {
    send: SendSMS;
    /** Mandatory destination policy to bound SMS abuse/cost. Receives normalized E.164. */
    allowed: (number: string) => boolean | Promise<boolean>;
  };
  passkeys?: boolean;
  usernames?: boolean;
  allowSignUp?: boolean;
  twoFactor?: { delivery?: "email" | "sms"; page?: string };
  /** Optional organization/admin/OIDC plugins. Additional protocols need their own policy tests. */
  plugins?: P;
  limits?: { requestsPerMinute?: number; mutationsPerMinute?: number; concurrent?: number; maxBodyBytes?: number; bodyTimeoutMs?: number; emailsPerMinute?: number; smsPerMinute?: number };
  budget?: RequestBudget;
  /** Inject a trusted socket/ingress identity; forwarding headers are ignored by default. */
  clientKey?: (request: Request) => string | Promise<string>;
  /** Deliberately excludes URL queries, request headers/bodies and provider error details. */
  onEvent?: (event: { path: string; method: string; status: number; durationMs: number }) => void | Promise<void>;
}

function configuration(options: AuthOptions) {
  const url = new URL(options.baseURL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local && options.allowInsecureLocalhost))) {
    throw new TypeError("Auth baseURL must be an HTTPS origin (explicit loopback HTTP is allowed for development)");
  }
  if (!/^[A-Za-z0-9_-]{43,}$/.test(options.secret) || new Set(options.secret).size < 12) throw new TypeError("Auth secret must contain at least 32 random bytes encoded as hex or base64url");
  if (!options.database) throw new TypeError("Persistent auth database is required");
  const basePath = options.basePath ?? "/api/auth";
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath)) throw new TypeError("Invalid auth basePath");
  const page = options.twoFactor?.page ?? "/login?mfa=1";
  if (!page.startsWith("/") || page.startsWith("//") || new URL(page, url).origin !== url.origin || page.includes("\\")) throw new TypeError("2FA page must be a same-origin path");
  if (options.twoFactor?.delivery === "sms" && !options.phone) throw new TypeError("SMS second factor requires phone delivery");
  if (options.twoFactor?.delivery === "email" && !options.email) throw new TypeError("Email second factor requires email delivery");
  const limits = { requestsPerMinute: 240, mutationsPerMinute: 30, concurrent: 4, maxBodyBytes: 128 << 10, bodyTimeoutMs: 10000, emailsPerMinute: 60, smsPerMinute: 10, ...options.limits };
  if (Object.values(limits).some(v => !Number.isSafeInteger(v) || v < 1)) throw new TypeError("Invalid auth resource limit");
  return { origin: url.origin, hostname: url.hostname, secure: url.protocol === "https:", basePath, page, limits };
}

export function createAuth<const P extends BetterAuthPlugin[] = []>(options: AuthOptions<P>) {
  const config = configuration(options);
  const budget = options.budget ?? memoryBudget();
  let pending = 0;
  const deliveryBudget = async (channel: "email" | "sms", target: string, purpose: string) => {
    const key = createHmac("sha256", options.secret).update(target.toLowerCase()).digest("hex");
    for (const [id, limit, window] of [
      [`delivery:${channel}`, channel === "email" ? config.limits.emailsPerMinute : config.limits.smsPerMinute, 60000],
      [`delivery:${channel}:${key}:${purpose}`, 1, 30000],
    ] as const) {
      const result = await budget.consume(id, limit, window);
      if (!result.allowed) throw new APIError("TOO_MANY_REQUESTS", { message: "Delivery temporarily limited" });
    }
  };
  const sendEmail: SendEmail = async message => {
    if (message.to.endsWith("@phone.invalid")) throw new APIError("BAD_REQUEST", { message: "Add a verified email first" });
    await deliveryBudget("email", message.to, message.purpose);
    try { await options.email!.send(message); }
    catch { throw new APIError("SERVICE_UNAVAILABLE", { message: "Email delivery unavailable" }); }
  };
  const sendSMS: SendSMS = async message => {
    if (!/^\+[1-9]\d{7,14}$/.test(message.to) || !options.phone || !(await options.phone.allowed(message.to))) throw new APIError("FORBIDDEN", { message: "SMS destination denied" });
    await deliveryBudget("sms", message.to, message.purpose);
    try { await options.phone.send(message); }
    catch { throw new APIError("SERVICE_UNAVAILABLE", { message: "SMS delivery unavailable" }); }
  };
  const factor = allMethodsTwoFactor({
    issuer: options.appName ?? "OPTZ", allowPasswordless: true,
    skipVerificationOnEnable: false, twoFactorCookieMaxAge: 300, trustDeviceMaxAge: 604800,
    backupCodeOptions: { amount: 10, length: 12, storeBackupCodes: "encrypted" },
    accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
    ...(options.twoFactor?.delivery ? { otpOptions: {
      storeOTP: "hashed" as const, allowedAttempts: 3, period: 3,
      async sendOTP({ user, otp }: { user: { email: string; emailVerified: boolean; phoneNumber?: string; phoneNumberVerified?: boolean }; otp: string }) {
        if (options.twoFactor!.delivery === "sms") {
          if (!user.phoneNumberVerified || !user.phoneNumber || !(await options.phone!.allowed(user.phoneNumber))) throw new APIError("FORBIDDEN", { message: "A verified phone is required" });
          await sendSMS({ to: user.phoneNumber, code: otp, purpose: "second-factor" });
        } else {
          if (!user.emailVerified) throw new APIError("FORBIDDEN", { message: "A verified email is required" });
          await sendEmail({ to: user.email, code: otp, purpose: "second-factor" });
        }
      },
    } } : {}),
  });
  const plugins = [
    factor,
    ...(options.usernames === false ? [] : [username({ minUsernameLength: 3, maxUsernameLength: 32, usernameValidator: name => /^[a-zA-Z0-9_]+$/.test(name) })]),
    ...(options.passkeys === false ? [] : [passkey({
      rpID: config.hostname, rpName: options.appName ?? "OPTZ", origin: config.origin,
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      registration: { requireSession: true, async afterVerification({ verification, ctx, user }) {
        if (!verification.registrationInfo?.userVerified) throw new APIError("FORBIDDEN", { message: "Passkey user verification is required" });
        const keys = await ctx.context.adapter.findMany({ model: "passkey", where: [{ field: "userId", value: user.id }], limit: 10 });
        if (keys.length >= 10) throw new APIError("FORBIDDEN", { message: "Passkey capacity reached" });
      } },
      authentication: { afterVerification({ verification }) {
        if (!verification.authenticationInfo.userVerified) throw new APIError("FORBIDDEN", { message: "Passkey user verification is required" });
      } },
    })]),
    ...(options.email?.otp === false || !options.email ? [] : [emailOTP({
      otpLength: 6, expiresIn: 300, allowedAttempts: 3, storeOTP: "hashed",
      disableSignUp: options.allowSignUp === false,
      changeEmail: { enabled: true, verifyCurrentEmail: true },
      sendVerificationOTP: ({ email, otp, type }) => sendEmail({ to: email, code: otp, purpose: type }),
    })]),
    ...(options.email?.magicLink === false || !options.email ? [] : [magicLink({
      expiresIn: 300, storeToken: "hashed", disableSignUp: options.allowSignUp === false,
      sendMagicLink: ({ email, url }) => sendEmail({ to: email, url, purpose: "magic-link" }),
    })]),
    ...(!options.phone ? [] : [phoneNumber({
      otpLength: 6, expiresIn: 300, allowedAttempts: 3, requireVerification: true,
      phoneNumberValidator: number => /^\+[1-9]\d{7,14}$/.test(number) && options.phone!.allowed(number),
      sendOTP: ({ phoneNumber, code }) => sendSMS({ to: phoneNumber, code, purpose: "sign-in" }),
      sendPasswordResetOTP: ({ phoneNumber, code }) => sendSMS({ to: phoneNumber, code, purpose: "reset-password" }),
      ...(options.allowSignUp === false ? {} : { signUpOnVerification: {
        // Reserved, unroutable domain; never mistake an SMS-only account for verified email.
        getTempEmail: number => `${number.slice(1)}@phone.invalid`, getTempName: () => "Phone user",
      } }),
    })]),
    ...(options.plugins ?? []),
  ];
  const auth = betterAuth({
    appName: options.appName ?? "OPTZ", database: options.database,
    baseURL: config.origin, basePath: config.basePath, secret: options.secret,
    trustedOrigins: [config.origin], socialProviders: options.socialProviders,
    telemetry: { enabled: false }, logger: { disabled: true }, onAPIError: { throw: true },
    session: { expiresIn: 604800, updateAge: 86400, freshAge: 300, cookieCache: { enabled: false } },
    account: { encryptOAuthTokens: true, storeStateStrategy: "database", skipStateCookieCheck: false,
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: false, allowUnlinkingAll: false } },
    advanced: {
      useSecureCookies: config.secure, cookiePrefix: "optz-auth",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: config.secure, path: "/" },
      crossSubDomainCookies: { enabled: false }, disableCSRFCheck: false, disableOriginCheck: false,
      ipAddress: { disableIpTracking: true },
    },
    // The HTTP wrapper enforces budgets without reading caller-forgeable IP headers.
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: !!options.email && options.email.password !== false, requireEmailVerification: true,
      minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: false,
      disableSignUp: options.allowSignUp === false, revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 900,
      onPasswordReset: ({ user }) => revokeChallenges(user.id),
      password: {
        hash: password => Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 }),
        verify: ({ password, hash }) => Bun.password.verify(password, hash),
      },
      sendResetPassword: ({ user, url }) => sendEmail({ to: user.email, url, purpose: "reset-password" }),
    },
    emailVerification: {
      sendOnSignUp: !!options.email, autoSignInAfterVerification: false, expiresIn: 900,
      sendVerificationEmail: ({ user, url }) => sendEmail({ to: user.email, url, purpose: "verify-email" }),
    },
    user: { changeEmail: { enabled: !!options.email }, deleteUser: { enabled: false } },
    databaseHooks: { user: { create: { before: async () => options.allowSignUp === false ? false : undefined } } },
    hooks: { before: createAuthMiddleware(async ctx => {
      const sensitive = ["/two-factor/enable", "/two-factor/disable", "/two-factor/generate-backup-codes", "/passkey/generate-register-options", "/passkey/verify-registration", "/passkey/delete-passkey", "/change-email", "/change-password", "/set-password", "/link-social", "/unlink-account", "/phone-number/verify"];
      if (!sensitive.includes(ctx.path ?? "") || !ctx.headers) return;
      const session = await getSession(new Request(config.origin, { headers: ctx.headers }));
      if (session && Date.now() - new Date(session.session.createdAt).getTime() > 300000) throw new APIError("FORBIDDEN", { message: "Reauthenticate before changing security settings" });
    }), after: createAuthMiddleware(async ctx => {
      // Enrollment replaces the active session; revoke every older session at the same boundary.
      const next = ctx.context.newSession;
      if (["/two-factor/verify-totp", "/two-factor/enable"].includes(ctx.path ?? "") && next?.user.twoFactorEnabled && ctx.context.session && !ctx.context.session.user.twoFactorEnabled) {
        await ctx.context.adapter.deleteMany({ model: "session", where: [{ field: "userId", value: next.user.id }, { field: "token", value: next.session.token, operator: "ne" }] });
        await revokeChallenges(next.user.id);
      }
      if (ctx.path === "/two-factor/disable" && next && !next.user.twoFactorEnabled) await revokeChallenges(next.user.id);
      if (["/change-password", "/set-password"].includes(ctx.path ?? "") && ctx.context.session && ctx.context.returned && !(ctx.context.returned instanceof APIError)) await revokeChallenges(ctx.context.session.user.id);
    }) },
    plugins,
  });

  async function revokeChallenges(userId: string) {
    const context = await auth.$context;
    for (const prefix of ["trust-device-", "2fa-"]) await context.adapter.deleteMany({ model: "verification", where: [{ field: "value", value: userId }, { field: "identifier", value: prefix, operator: "starts_with" }] });
  }
  const knownPaths = new Set(Object.values(auth.api).map(endpoint => (endpoint as { path?: string }).path).filter((path): path is string => !!path && !/[:*]/.test(path)));

  const matches = (request: Request) => { const path = new URL(request.url).pathname; return path === config.basePath || path.startsWith(config.basePath + "/"); };
  const handler = async (request: Request): Promise<Response> => {
    const started = performance.now();
    const path = new URL(request.url).pathname.slice(config.basePath.length) || "/";
    const finish = (response: Response) => {
      if (options.onEvent) {
        // OAuth provider segment can be arbitrary input. Do not put identifiers in telemetry.
        const safePath = knownPaths.has(path) ? path : path.startsWith("/callback/") ? "/callback/:provider" : path.startsWith("/oauth2/callback/") ? "/oauth2/callback/:provider" : path.startsWith("/reset-password/") ? "/reset-password/:token" : "/:unknown";
        try { void Promise.resolve(options.onEvent({ path: safePath, method: request.method, status: response.status, durationMs: performance.now() - started })).catch(() => {}); } catch {}
      }
      return privateResponse(response);
    };
    if (!matches(request)) return finish(new Response(null, { status: 404 }));
    // OAuth POST callbacks use state/cookie validation upstream; other browser mutations require Origin.
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (mutation && !path.startsWith("/callback/") && !path.startsWith("/oauth2/callback/")) {
      if (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site") return finish(new Response("Origin denied", { status: 403 }));
    }
    let identity: string;
    try { identity = options.clientKey ? await options.clientKey(request) : "shared"; }
    catch { return finish(new Response("Authentication unavailable", { status: 503 })); }
    if (typeof identity !== "string" || identity.length > 256 || !identity) return finish(new Response("Invalid request identity", { status: 400 }));
    const digest = Bun.hash(identity).toString(36);
    try {
      for (const [key, limit] of [["all", config.limits.requestsPerMinute], ...(mutation ? [["mutations", config.limits.mutationsPerMinute] as const] : [])] as const) {
        const result = await budget.consume(`${digest}:${key}`, limit, 60000);
        if (!result.allowed) return finish(new Response("Try again later", { status: 429, headers: { "Retry-After": String(result.retryAfter) } }));
      }
    } catch { return finish(new Response("Authentication unavailable", { status: 503 })); }
    if (pending >= config.limits.concurrent) return finish(new Response("Authentication busy", { status: 503, headers: { "Retry-After": "1" } }));
    pending++;
    try {
      let response = await auth.handler(await boundedRequest(request, config.limits.maxBodyBytes, config.limits.bodyTimeoutMs));
      if (request.method === "GET" && (path.startsWith("/callback/") || path === "/magic-link/verify" || path.startsWith("/oauth2/callback/")) && response.headers.get("content-type")?.includes("application/json")) {
        const result = await response.clone().json().catch(() => null);
        if (result?.twoFactorRedirect) { const headers = new Headers(response.headers); headers.set("Location", config.page); response = new Response(null, { status: 303, headers }); }
      }
      return finish(response);
    } catch (error) { return finish(error instanceof Response ? error : new Response("Authentication unavailable", { status: 500 })); }
    finally { pending--; }
  };
  type Session = typeof auth.$Infer.Session;
  // Retain core endpoints when TypeScript cannot reduce a caller's generic plugin tuple.
  const api = auth.api as typeof auth.api & ReturnType<typeof betterAuth>["api"];
  const getSession = (request: Request): Promise<Session | null> => api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } }) as Promise<Session | null>;
  const requireSession = async (request: Request, policy: { mfa?: boolean; freshSeconds?: number } = {}) => {
    if (policy.freshSeconds !== undefined && (!Number.isSafeInteger(policy.freshSeconds) || policy.freshSeconds < 0)) throw new TypeError("Invalid freshness policy");
    const session = await getSession(request);
    if (!session) throw privateResponse(Response.json({ error: "UNAUTHENTICATED" }, { status: 401 }));
    if (policy.mfa && !(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) throw privateResponse(Response.json({ error: "MFA_ENROLLMENT_REQUIRED" }, { status: 403 }));
    if (policy.freshSeconds !== undefined && Date.now() - new Date(session.session.createdAt).getTime() > policy.freshSeconds * 1000) throw privateResponse(Response.json({ error: "REAUTHENTICATION_REQUIRED" }, { status: 403 }));
    return session;
  };
  return { ...auth, api, handler, fetch: handler, matches, getSession, requireSession,
    middleware: async (ctx: { request: Request }, next: () => Promise<Response>) => matches(ctx.request) ? handler(ctx.request) : next(),
  };
}

export type OptzAuth = ReturnType<typeof createAuth>;
