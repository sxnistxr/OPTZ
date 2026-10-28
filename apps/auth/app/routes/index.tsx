export const head = () => ({ title: "OPTZ Auth" });
export default function Home() {
  return <><h1>Full authentication. Optional by design.</h1><p>OAuth, verified email, phone codes, passkeys, authenticator apps, and recovery codes.</p><p>This public page is static and ships no auth client or database lookup.</p><a href="/login">Open the authentication example</a></>;
}
