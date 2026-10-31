import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OgCard } from "../app/lib/og-card";
import site from "../content/site.json";

test.each([undefined, "https://preview.example.test/deployment"])("card hostname follows SITE_URL (%s)", (url) => {
  const previous = process.env.SITE_URL;
  try {
    if (url === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = url;
    const markup = renderToStaticMarkup(<OgCard title="A page" />);
    expect(markup).toContain(new URL(url ?? site.url).hostname);
    if (url) expect(markup).not.toContain(new URL(site.url).hostname);
  } finally {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  }
});
