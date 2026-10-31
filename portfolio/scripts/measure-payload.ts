import { readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const directory = join(root, "dist/static");
const path = "/blog/sqlite-was-reparsing-my-query";
const file = join(directory, path, "index.html");
const html = await readFile(file, "utf8");
const scripts = [...new Set(Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), match => match[1]))];
let javascriptGzipBytes = 0;
for (const script of scripts) {
  if (!script.startsWith("/") || script.startsWith("//")) throw new Error(`Unmeasurable external script: ${script}`);
  javascriptGzipBytes += (await stat(join(directory, `${script}.gz`))).size;
}
const result = {
  path,
  measuredAt: new Date().toISOString().slice(0, 10),
  htmlBytes: (await stat(file)).size,
  htmlGzipBytes: (await stat(`${file}.gz`)).size,
  javascriptGzipBytes,
  scope: "Production blog page. Gzip; HTML and external scripts only. Excludes CSS, fonts, the OPTZ hero, and the spotlight demo.",
};
await writeFile(join(root, "content/optz-payload.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
