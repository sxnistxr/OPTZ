// Server/startup-only environment contracts. No provider, network, or browser runtime.
export interface EnvRule {
  type?: "string" | "url" | "number" | "boolean" | "json";
  optional?: boolean;
  default?: string;
  values?: readonly string[];
  /** Only explicitly selected PUBLIC_* variables may enter generated browser JSON. */
  public?: boolean;
}
export type EnvRules = Record<string, EnvRule>;
export interface EnvManifest {
  $schema?: string;
  doppler?: {
    project?: string;
    config?: string | Record<string, string>;
    /** Default: encrypted fallback in development, fail closed in production. */
    fallback?: boolean;
    /** Doppler restarts the dev process when secrets rotate; opt-in (upstream beta). */
    watch?: boolean;
    /** Explicit local overrides only; never preserve the entire inherited environment. */
    preserve?: string[];
  };
  variables: EnvRules;
}
type Value<R extends EnvRule> = R["type"] extends "number" ? number : R["type"] extends "boolean" ? boolean : R["type"] extends "json" ? unknown : string;
export type Environment<R extends EnvRules> = { readonly [K in keyof R]: R[K]["optional"] extends true ? Value<R[K]> | undefined : Value<R[K]> };
const name = /^[A-Z_][A-Z0-9_]*$/;
const identifier = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;

export function checkEnvManifest(value: unknown): asserts value is EnvManifest {
  const manifest = value as EnvManifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !manifest.variables || typeof manifest.variables !== "object" || Array.isArray(manifest.variables)) throw new Error("optz.env.json requires a variables object");
  if (Object.keys(manifest).some(k => !["variables", "doppler", "$schema"].includes(k)) || (manifest.$schema !== undefined && typeof manifest.$schema !== "string")) throw new Error("Unknown environment manifest field");
  for (const [key, rule] of Object.entries(manifest.variables)) {
    if (!name.test(key) || key.startsWith("DOPPLER_") || key === "__OPTZ_DOPPLER_ACTIVE" || !rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error("Invalid or reserved environment rule name or shape");
    if (Object.keys(rule).some(k => !["type", "optional", "default", "values", "public"].includes(k)) || (rule.type !== undefined && !["string", "url", "number", "boolean", "json"].includes(rule.type)) || (rule.default !== undefined && typeof rule.default !== "string") || [rule.optional, rule.public].some(v => v !== undefined && typeof v !== "boolean") || (rule.values !== undefined && (!Array.isArray(rule.values) || !rule.values.length || rule.values.some(v => typeof v !== "string")))) throw new Error(`Invalid environment rule: ${key}`);
    if (rule.public && (!key.startsWith("PUBLIC_") || key.startsWith("DOPPLER_"))) throw new Error(`Public environment names must start with PUBLIC_: ${key}`);
  }
  const d = manifest.doppler;
  if (d !== undefined) {
    if (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).some(k => !["project", "config", "fallback", "watch", "preserve"].includes(k))) throw new Error("Invalid Doppler configuration");
    if (d.project !== undefined && (typeof d.project !== "string" || !identifier.test(d.project))) throw new Error("Invalid Doppler project");
    const configs = typeof d.config === "string" ? [d.config] : d.config && typeof d.config === "object" && !Array.isArray(d.config) ? Object.values(d.config) : d.config === undefined ? [] : [null];
    if (configs.some(v => typeof v !== "string" || !identifier.test(v)) || [d.fallback, d.watch].some(v => v !== undefined && typeof v !== "boolean") || (d.preserve && (!Array.isArray(d.preserve) || d.preserve.some(v => typeof v !== "string" || !name.test(v))))) throw new Error("Invalid Doppler config, fallback, watch or preserve setting");
  }
}

/** Errors contain names/reasons, never values. Empty required variables fail at startup. */
export function readEnv<const R extends EnvRules>(rules: R, source: Record<string, string | undefined> = process.env): Environment<R> {
  checkEnvManifest({ variables: rules });
  const out: Record<string, unknown> = Object.create(null), errors: string[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    const value = source[key] ?? rule.default;
    if (value === undefined || value === "") { if (!rule.optional) errors.push(`${key} (required)`); continue; }
    try {
      if (rule.values && !rule.values.includes(value)) throw 0;
      if (rule.type === "number") { if (!value.trim() || !Number.isFinite(Number(value))) throw 0; out[key] = Number(value); }
      else if (rule.type === "boolean") { if (!["true", "false"].includes(value)) throw 0; out[key] = value === "true"; }
      else if (rule.type === "json") out[key] = JSON.parse(value);
      else { if (rule.type === "url" && !["https:", "http:", "postgres:", "postgresql:", "mysql:", "redis:", "rediss:"].includes(new URL(value).protocol)) throw 0; out[key] = value; }
    } catch { errors.push(`${key} (invalid ${rule.type ?? "string"})`); }
  }
  if (errors.length) throw new Error(`Invalid environment: ${errors.join(", ")}`);
  return Object.freeze(out) as Environment<R>;
}
