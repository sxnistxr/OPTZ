import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { isActionSource } from "../src/actions";
import { codeLiteral } from "../src/code-literal";
import { readFileSnapshot, writeFileAtomic } from "../src/file-io";
import { htmlText, pageText } from "../src/html";
import { trimSlashes } from "../src/match";
import { cachedFetch } from "../src/net-cache";
import { Link, safeLinkHref } from "../src/runtime";

test("action directives accept comments and reject adversarial or unterminated prefixes", () => {
  expect(isActionSource('\uFEFF /* a */ // b\r\n\t"use server";')).toBe(true);
  expect(isActionSource('/* a */'.repeat(30_000) + "'use server';")).toBe(true);
  expect(isActionSource('/*' + '*//*'.repeat(30_000))).toBe(false);
  expect(isActionSource('// "use server"')).toBe(false);
  expect(isActionSource('import "x"; "use server";')).toBe(false);
});

test("page extraction uses text nodes and omits nested hidden markup", () => {
  expect(pageText(`<title>Docs &amp; more</title><meta content='A &quot;guide&quot;' name='description'>
    <body>outside<main><nav><nav>hidden</nav>also hidden</nav><h1 title='a > b'>Hello</h1>
    <p>Read <a href='/x'>the <b>guide</b></a>.</p><script>bad('<main>');</script>
    <template><template>secret</template>secret too</template><pre><code>a &lt; b</code></pre></main></body>`))
    .toEqual({ title: "Docs & more", description: 'A "guide"', text: "# Hello\n\n Read [the guide](/x).\n\n```\na < b\n```" });
  expect(htmlText('<b>&amp;lt;safe&amp;gt;</b>')).toBe('&lt;safe&gt;');
  expect(pageText('<main><p>visible</p><!-- <script>hidden</script> --></main>').text).toBe('visible');
});

test("page and path parsing stays bounded for repeated incomplete tags and slashes", () => {
  expect(pageText('<title'.repeat(30_000)).title).toBe("");
  expect(pageText('<main>'.repeat(30_000) + 'text').text).toBe("text");
  expect(trimSlashes('/'.repeat(100_000) + 'docs' + '/'.repeat(100_000))).toBe('docs');
  expect(trimSlashes('/'.repeat(100_000))).toBe('');
});

test("links reject executable schemes after browser-style URL normalization", () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' \tjava\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
    expect(safeLinkHref(href)).toBe('#');
    expect(renderToStaticMarkup(<Link href={href}>link</Link>)).toContain('href="#"');
  }
  for (const href of ['/docs?x=1#part', '../about', '#part', '//example.com/path', 'https://example.com', 'mailto:a@example.com', 'tel:+123']) {
    expect(safeLinkHref(href)).toBe(href);
  }
  expect(safeLinkHref('/docs/a%20b?x="<tag>"')).toBe('/docs/a%20b?x=%22%3Ctag%3E%22');
});

test("generated literals preserve values without HTML delimiters or JS line separators", () => {
  const value = { path: 'a\\b"</script><script>bad()</script>\u2028\u2029' };
  const literal = codeLiteral(value);
  expect(literal).not.toMatch(/[<>\u2028\u2029]/);
  expect(JSON.parse(literal)).toEqual(value);
  expect(codeLiteral(undefined)).toBe('undefined');
});

test("atomic publication replaces a destination symlink without modifying its target", () => {
  const dir = mkdtempSync(join(tmpdir(), 'optz-security-'));
  try {
    const target = join(dir, 'target'), file = join(dir, 'file');
    writeFileSync(target, 'keep');
    symlinkSync(target, file);
    writeFileAtomic(file, 'new');
    expect(readFileSnapshot(file).body.toString()).toBe('new');
    expect(readFileSync(target, 'utf8')).toBe('keep');
    expect(readdirSync(dir).sort()).toEqual(['file', 'target']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed cache refresh reuses its snapshot even if the cache pathname disappears", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'optz-net-cache-'));
  const previous = process.env.OPTZ_CACHE_DIR;
  process.env.OPTZ_CACHE_DIR = dir;
  const fetch = spyOn(globalThis, 'fetch');
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    fetch.mockResolvedValueOnce(new Response('cached bytes'));
    await cachedFetch('https://fonts.example/font');
    fetch.mockImplementationOnce(Object.assign(async () => {
      unlinkSync(join(dir, 'downloads', readdirSync(join(dir, 'downloads'))[0]));
      throw new Error('offline');
    }, { preconnect: globalThis.fetch.preconnect }));
    expect(new TextDecoder().decode(await cachedFetch('https://fonts.example/font', { maxAgeDays: -1 }))).toBe('cached bytes');
  } finally {
    fetch.mockRestore();
    warn.mockRestore();
    if (previous === undefined) delete process.env.OPTZ_CACHE_DIR;
    else process.env.OPTZ_CACHE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
