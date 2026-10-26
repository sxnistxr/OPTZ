import { json } from "optz";

// Prerendered: GET runs once at build time; requests get the result from memory.
export const prerender = true;
export const GET = () => json({ builtAt: Date.now(), env: "build" });
