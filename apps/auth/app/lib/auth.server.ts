import { join } from "node:path";
import { createAuth } from "@optz/auth";
import { openAuthDatabase, migrateAuth, sqliteBudget } from "@optz/auth/sqlite";
import { resend, twilio } from "@optz/auth/delivery";

const providerNames = ["google", "github", "microsoft", "apple", "discord", "facebook", "twitter", "linkedin", "gitlab", "twitch", "spotify", "slack"] as const;
export function features() {
  return { email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    phone: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.SMS_FROM),
    providers: providerNames.filter(name => process.env[`${name.toUpperCase()}_CLIENT_ID`] && process.env[`${name.toUpperCase()}_CLIENT_SECRET`]),
  };
}
function initialize() {
  const enabled = features(), root = join(import.meta.dir, "../..");
  const db = openAuthDatabase(process.env.AUTH_DATABASE_PATH ?? join(root, ".data/auth.sqlite"));
  const socialProviders = Object.fromEntries(enabled.providers.map(name => [name, {
    clientId: process.env[`${name.toUpperCase()}_CLIENT_ID`]!, clientSecret: process.env[`${name.toUpperCase()}_CLIENT_SECRET`]!,
  }]));
  return createAuth({ database: db, budget: sqliteBudget(db),
    baseURL: process.env.PUBLIC_URL ?? "http://localhost:3008", allowInsecureLocalhost: true,
    secret: process.env.AUTH_SECRET ?? "", appName: "OPTZ Auth", socialProviders,
    allowSignUp: process.env.AUTH_ALLOW_SIGNUP !== "false",
    email: enabled.email ? { send: resend({ apiKey: process.env.RESEND_API_KEY!, from: process.env.EMAIL_FROM! }) } : undefined,
    phone: enabled.phone ? {
      send: twilio({ accountSid: process.env.TWILIO_ACCOUNT_SID!, authToken: process.env.TWILIO_AUTH_TOKEN!, from: process.env.SMS_FROM! }),
      allowed: number => (process.env.SMS_ALLOWED_PREFIXES ?? "").split(",").filter(Boolean).some(prefix => number.startsWith(prefix)),
    } : undefined,
  });
}
let instance: ReturnType<typeof initialize> | undefined;
export const getAuth = () => instance ??= initialize();
if (import.meta.main) {
  const execute = process.argv.includes("--migrate");
  const sql = await migrateAuth(getAuth(), execute);
  console.log(execute ? "Auth schema ready." : sql || "Auth schema is current.");
}
