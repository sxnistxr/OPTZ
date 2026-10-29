// Standard Schema works with Zod, Valibot and other validators without bundling one.
import { readBody, BodyLimitError } from "./body";
export interface InputIssue { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] }
export interface StandardSchema<T> {
  readonly "~standard": {
    version: 1; vendor: string;
    validate(value: unknown): { value: T; issues?: undefined } | { issues: readonly InputIssue[] } | Promise<{ value: T; issues?: undefined } | { issues: readonly InputIssue[] }>;
  };
}
export class ValidationError extends Error {
  constructor(readonly fields: Record<string, string[]>) { super("Invalid input"); }
}
export type Validator<T> = StandardSchema<T> | ((input: unknown) => T | Promise<T>);
export async function validateInput<T>(schema: Validator<T>, input: unknown): Promise<T> {
  if (typeof schema === "function") return schema(input);
  const result = await schema["~standard"].validate(input);
  if (!result.issues) return result.value;
  const fields: Record<string, string[]> = Object.create(null);
  for (const issue of result.issues.slice(0, 100)) {
    const key = issue.path?.map(p => String(typeof p === "object" ? p.key : p)).join(".") || "_form";
    (fields[key] ??= []).push(issue.message);
  }
  throw new ValidationError(fields);
}
export function formValues(data: FormData): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const result: Record<string, FormDataEntryValue | FormDataEntryValue[]> = Object.create(null);
  for (const [key, value] of data) {
    const old = result[key];
    if (Array.isArray(old)) old.push(value);
    else result[key] = old === undefined ? value : [old, value];
  }
  return result;
}
/** Throws a safe 400/413/415/422 Response; API routes already forward thrown Responses. */
export async function parseInput<T>(request: Request, schema: Validator<T>, options: { maxBytes?: number; timeoutMs?: number } = {}): Promise<T> {
  const fail = (status: number, error: string, fields?: Record<string, string[]>) => Response.json({ error, ...(fields ? { fields } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
  const type = request.headers.get("content-type") ?? "";
  const isJson = /^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(type);
  const isForm = /^(application\/x-www-form-urlencoded|multipart\/form-data)(?:;|$)/i.test(type);
  if (!isJson && !isForm) throw fail(415, "Send JSON or form data");
  let input: unknown;
  try {
    const bytes = await readBody(request.body, options.maxBytes ?? (1 << 20), options.timeoutMs);
    input = isJson ? JSON.parse(new TextDecoder().decode(bytes)) : formValues(await new Response(bytes as BodyInit, { headers: { "Content-Type": type } }).formData());
  } catch (error) { throw fail(error instanceof BodyLimitError ? 413 : 400, error instanceof BodyLimitError ? "Request body exceeds its limit" : "Malformed input"); }
  try { return await validateInput(schema, input); }
  catch (error) { if (error instanceof ValidationError) throw fail(422, "Invalid input", error.fields); throw error; }
}
