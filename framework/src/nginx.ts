// `optz nginx`: an nginx site config generated from optz.config.ts, so the fast paths never
// touch Bun in production:
//   proxy prefixes with bypassMiddleware (or when there's no middleware) -> straight to their
//                    targets, same path, protocol, Host and limits as the Bun proxy, with an
//                    optional GET micro-cache
//   /assets/       -> from disk: immutable, pre-compressed (gzip_static)
//   everything else -> the optz server, with forwarding headers set by nginx (a client's own
//                    X-Forwarded-* never get through)
// With a server name (opts.serverName, else site.url's host), requests for any other Host are
// refused: the app only ever sees its own name.
import type { ResolvedConfig } from "./types";

export interface NginxOptions {
  distDir: string;
  serverName?: string;
  listen?: number;
  /** HTTPS: a certificate directory with fullchain.pem and privkey.pem (e.g. Let's Encrypt's
   *  /etc/letsencrypt/live/<domain>). Port 80 then only redirects (and answers ACME challenges). */
  tls?: { certDir: string };
  /** The app has middleware: proxy prefixes without bypassMiddleware must go through Bun. */
  hasMiddleware?: boolean;
  /** Trusted CA bundle for HTTPS upstreams; defaults to the Debian/Ubuntu system store. */
  upstreamCaFile?: string;
}

/** The site's name: opts.serverName, else site.url's host, else "_" (any). */
function serverNameFor(config: ResolvedConfig, opts: NginxOptions): string {
  if (opts.serverName) return opts.serverName;
  try {
    return config.site?.url ? new URL(config.site.url).hostname : "_";
  } catch {
    return "_";
  }
}

export function nginxConfig(config: ResolvedConfig, opts: NginxOptions) {
  const port = Number(process.env.PORT ?? config.port ?? 3001);
  const name0 = serverNameFor(config, opts);
  // Only prefixes that may skip middleware get their own location; the rest reach Bun.
  const proxies = Object.entries(config.proxy ?? {})
    .filter(([, r]) => r.bypassMiddleware || !opts.hasMiddleware)
    .sort((a, b) => b[0].length - a[0].length);
  const name = (p: string) => "optz_" + p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
  const cached = proxies.filter(([, r]) => r.cacheSeconds);
  const upstreams = proxies
    .map(([prefix, r]) => {
      const t = new URL(r.target);
      const hostPort = t.port ? t.host : `${t.hostname}:${t.protocol === "https:" ? 443 : 80}`;
      return `upstream ${name(prefix)} {\n    server ${hostPort};\n    keepalive 64;\n}`;
    })
    .join("\n");
  const locations = proxies
    .map(([prefix, r]) => {
      const t = new URL(r.target);
      const tpath = t.pathname.replace(/\/+$/, "");
      // nginx replaces the matched "prefix/" with the URI after the upstream name, so this keeps
      // the target's path and strips (or keeps) the prefix exactly like the Bun proxy.
      const uri = r.strip ? `${tpath}/` : tpath ? `${tpath}${prefix}/` : "";
      const target = `${t.protocol === "https:" ? "https" : "http"}://${name(prefix)}${uri}`;
      const limit = Math.ceil((r.maxBodySize ?? config.server.maxRequestBodySize) / 1024);
      const timeout = Math.ceil((r.timeoutMs ?? 30_000) / 1000);
      const cache = r.cacheSeconds
        ? `
        # Micro-cache GETs: at most one request per ${r.cacheSeconds}s per URL reaches the upstream.
        proxy_cache optz_micro;
        proxy_cache_methods GET HEAD;
        proxy_cache_valid 200 ${r.cacheSeconds}s;
        proxy_cache_lock on;
        proxy_cache_use_stale updating error timeout;
        proxy_cache_bypass $http_authorization $http_cookie;
        proxy_no_cache $http_authorization $http_cookie;
        add_header X-Cache $upstream_cache_status always;`
        : "";
      const ca = opts.upstreamCaFile ?? "/etc/ssl/certs/ca-certificates.crt";
      if (/[\r\n";{}]/.test(ca)) throw new Error("Invalid upstream CA path");
      const tls = t.protocol === "https:" ? `\n        proxy_ssl_server_name on;\n        proxy_ssl_name ${t.hostname};\n        proxy_ssl_verify on;\n        proxy_ssl_verify_depth 5;\n        proxy_ssl_trusted_certificate "${ca}";` : "";
      return `    location ${prefix}/ {
        proxy_pass ${target};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host ${t.host};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Forwarded "";
        proxy_connect_timeout 5s;
        proxy_read_timeout ${timeout}s;
        proxy_send_timeout ${timeout}s;
        client_max_body_size ${limit}k;${tls}${cache}
    }`;
    })
    .join("\n\n");
  const site = `    add_header X-Content-Type-Options nosniff always;

${locations}

    location /assets/ {
        alias ${opts.distDir.replace(/\/$/, "")}/static/assets/;
        gzip_static on;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header X-Content-Type-Options nosniff always;
        access_log off;
    }

    location / {
        proxy_pass http://optz_app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Set, not appended: what a client sends in these never reaches the app.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Forwarded "";
        client_max_body_size ${Math.ceil(config.server.maxRequestBodySize / 1024)}k;
    }
`;
  const host = name0;
  const strict = host !== "_";
  const def = strict ? "" : " default_server";
  const port80 = opts.listen ?? 80;
  const cert = opts.tls?.certDir.replace(/\/$/, "");
  // Requests for any other name (scanners, DNS rebinding) are dropped before reaching the app.
  const catchAll = strict
    ? `server {
    listen ${port80} default_server;
    listen [::]:${port80} default_server;
    server_name _;
    return 444;
}
${
  cert
    ? `
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;
    return 444;
}
`
    : ""
}
`
    : "";
  const servers = cert
    ? `${catchAll}server {
    listen ${port80}${def};
    listen [::]:${port80}${def};
    server_name ${host};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2${def};
    listen [::]:443 ssl http2${def};
    server_name ${host};

    ssl_certificate ${cert}/fullchain.pem;
    ssl_certificate_key ${cert}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:optz_tls:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    add_header Strict-Transport-Security "max-age=31536000" always;

${site}}`
    : `${catchAll}server {
    listen ${port80}${def};
    listen [::]:${port80}${def};
    server_name ${host};

${site}}`;
  return `# Generated by \`optz nginx\` from optz.config.ts.
${cached.length ? "proxy_cache_path /var/cache/nginx/optz levels=1:2 keys_zone=optz_micro:8m max_size=64m inactive=10m use_temp_path=off;\n" : ""}upstream optz_app {
    server 127.0.0.1:${port};
    keepalive 32;
}
${upstreams}

${servers}
`;
}
