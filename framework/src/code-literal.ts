/** A JSON value safe in generated JavaScript, including when embedded in an HTML script. */
export const codeLiteral = (value: unknown): string =>
  (JSON.stringify(value) ?? "undefined").replace(/[<>\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
