import type { ApiContext } from "optz";
import { parseInput } from "optz/forms";
import { app, limited, type User } from "$lib/app.server";
import { credentials } from "$lib/input.server";
const failure = (request: Request, status: number, message: string) => request.headers.get("accept")?.includes("text/html")
  ? new Response(null, { status: 303, headers: { Location: "/login?error=1", "Cache-Control": "no-store" } })
  : new Response(message, { status, headers: { "Cache-Control": "no-store" } });
let dummyHash: Promise<string> | undefined;
export async function POST({ request, params }: ApiContext<{ operation: string }>) {
  const state = app();
  if (params.operation === "logout") return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": await state.sessions.destroy(request), "Cache-Control": "no-store" } });
  if (!["login", "register"].includes(params.operation)) return new Response(null, { status: 404 });
  limited("auth"); // A process-wide budget, independent of client-forgeable forwarding headers.
  let values: ReturnType<typeof credentials>;
  try { values = await parseInput(request, credentials, { maxBytes: 8192 }); }
  catch (error) { if (error instanceof Response && request.headers.get("accept")?.includes("text/html")) return failure(request, error.status, "Invalid input"); throw error; }
  const { email, password } = values;
  if (state.authWork >= 2) return new Response("Authentication busy", { status: 503 });
  state.authWork++;
  try {
    let user: User | null;
    if (params.operation === "register") {
      const hash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
      user = state.db.query<User, [string, string, string, number]>("INSERT INTO users (id,email,password) SELECT ?,?,? WHERE (SELECT count(*) FROM users)<? ON CONFLICT(email) DO NOTHING RETURNING id,email").get(crypto.randomUUID(), email, hash, state.maxUsers);
      if (!user) return failure(request, 409, "Account could not be created");
    } else {
      const record = state.db.query<User & { password: string }, [string]>("SELECT id,email,password FROM users WHERE email=?").get(email);
      dummyHash ??= Bun.password.hash(crypto.randomUUID(), { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
      if (!(await Bun.password.verify(password, record?.password ?? await dummyHash)) || !record) return failure(request, 401, "Invalid credentials");
      user = { id: record.id, email: record.email };
    }
    return new Response(null, { status: 303, headers: { Location: "/dashboard", "Set-Cookie": await state.sessions.create(user, request), "Cache-Control": "no-store" } });
  } finally { state.authWork--; }
}
