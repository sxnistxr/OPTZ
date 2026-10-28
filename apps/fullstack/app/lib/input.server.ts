import { ValidationError } from "optz/forms";
export function textField(input: unknown, key: string, max = 2000, min = 1) {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  if (typeof value !== "string" || value.trim().length < min || value.length > max) throw new ValidationError({ [key]: [`Use ${min}–${max} characters`] });
  return value.trim();
}
export function credentials(input: unknown) {
  const email = textField(input, "email", 254).toLowerCase();
  const password = (input as Record<string, unknown>)?.password;
  if (typeof password !== "string" || password.length < 12 || password.length > 128 || !password.trim()) throw new ValidationError({ password: ["Use 12–128 characters"] });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError({ email: ["Enter an email address"] });
  return { email, password };
}
