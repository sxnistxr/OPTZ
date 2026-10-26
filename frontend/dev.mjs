// Local development: builds, serves dist/ on :8080, proxies /api/* to the API, and rebuilds
// when anything in content/ or src/ changes.
//   API_ORIGIN=http://127.0.0.1:3000 node dev.mjs
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, statSync, watch } from "node:fs";
import http from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const api = new URL(process.env.API_ORIGIN || "http://127.0.0.1:3000");
const port = Number(process.env.PORT || 8080);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json" };

const build = () => {
  try {
    execFileSync(process.execPath, [join(root, "build.mjs")], { stdio: "inherit" });
  } catch {
    console.error("build failed; serving the previous build");
  }
};
build();
let timer;
for (const dir of ["content", "src", "public"]) {
  watch(join(root, dir), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(build, 100);
  });
}

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      const up = http.request(
        { host: api.hostname, port: api.port, path: req.url.slice(4), method: req.method, headers: { ...req.headers, host: api.host } },
        (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end('{"error":"API not reachable at ' + api.origin + '"}');
      });
      return void req.pipe(up);
    }
    let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(dist, p);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": types[".html"] });
      return void createReadStream(join(dist, "404.html")).pipe(res);
    }
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`site on http://127.0.0.1:${port}, /api -> ${api.origin}`));
