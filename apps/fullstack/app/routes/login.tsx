import type { LoaderContext, PageProps } from "optz";
export const config = { render: "dynamic" } as const;
export const loader = ({ url }: LoaderContext) => ({ error: url.searchParams.has("error") });
export const head = () => ({ title: "Sign in", robots: "noindex" });
export default function Login({ data }: PageProps<{ error: boolean }>) {
  return <><h1>Welcome</h1>{data.error && <p role="alert">We could not complete that request. Check your details and try again.</p>}<p>Use at least 12 characters for your password.</p>{["login", "register"].map(operation => <section key={operation}><h2>{operation === "login" ? "Sign in" : "Create account"}</h2><form method="post" action={`/api/auth/${operation}`}><label>Email <input type="email" name="email" autoComplete="username" required maxLength={254} /></label><label>Password <input type="password" name="password" autoComplete={operation === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} required /></label><button>{operation === "login" ? "Sign in" : "Register"}</button></form></section>)}</>;
}
