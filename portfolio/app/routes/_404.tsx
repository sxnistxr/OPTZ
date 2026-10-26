import type { Head } from "optz";
import site from "$lib/site";

export const head = (): Head => ({ title: `Not found | ${site.title}` });

export default function NotFound() {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-[-0.02em]">This page doesn't exist</h1>
      <p className="mt-4 text-muted">
        Check the address, or start from the{" "}
        <a className="underline decoration-rule underline-offset-4" href="/">
          home page
        </a>
        .
      </p>
    </>
  );
}
