import { Link } from "optz";
export const head = () => ({ title: "OPTZ full-stack starter" });
export default function Home() { return <><h1>A full app, a small runtime.</h1><p>Persistent accounts, private notes and attachments, built on Bun and SQLite.</p><Link href="/login">Sign in or create an account</Link></>; }
