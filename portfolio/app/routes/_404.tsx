import type { Head } from "optz";
import site from "$lib/site";

export const head = (): Head => ({ title: `Not found | ${site.title}` });

export default function NotFound() {
  return (
    <div className="error-page">
      <h1 className="page-heading">This page doesn’t exist</h1>
      <p>
        Check the address, or start from the <a href="/">home page</a>.
      </p>
    </div>
  );
}
