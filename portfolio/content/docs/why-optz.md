# Why optz

Pick a framework by what your site does most. For most sites that's **serving pages people read**,
and that's what optz makes nearly free, without giving up the features an app needs.

## What you get, measured

Same app (this site's previous version), same machine, one pinned CPU core, production mode.
Full method and raw numbers: [optz vs Next.js](/docs/vs-nextjs).

| | optz | Next.js 16 |
|---|---:|---:|
| Static page | **~55,000 req/s** | ~400 req/s |
| Slowest 1% of requests | **~4 ms** | ~1 s |
| Memory under load | **52 MB** | 333 MB |
| JavaScript on a blog post | **2.9 KB** | 145 KB |
| Cold start | **74 ms** | 692 ms |
| Build | **1.8 s** | 9.5 s |

And against nginx, written in C, serving the same files: the same speed
([would C be faster?](/docs/native)).

## Why it's fast

- **Work moves to build time.** Pages are rendered once, compressed once, hashed once. A request
  is a lookup, not a render.
- **HTML by default.** Only islands ship JavaScript, hydrate on their own schedule, and can use
  Preact. Most pages need 3 KB or nothing.
- **One small runtime.** No router state, no RSC payloads, no per-request framework pipeline:
  a request for a static page runs about 3 µs of JavaScript.
- **Off when unused.** `features.*` turns off what a site doesn't need; with dynamic rendering
  off, React's server renderer never loads.

## What you don't give up

Streaming and async server components, Server Actions with forms that work without JavaScript,
incremental static regeneration and on-demand revalidation, typed routes and a typed API client,
middleware, parallel and intercepting routes, i18n, image and font optimization, Open Graph
images, sitemaps, draft mode, and deploys to a Bun server, a single executable or an edge
worker. [Feature by feature](/docs/vs-nextjs#features).

## Compared with others

- **Next.js**: the most complete ecosystem, and the RSC wire format (client router cache,
  Partial Prerendering, `"use cache"`). optz covers the features apps like this one use, at about
  100× the throughput per core.
- **Astro**: the closest idea (islands, HTML by default, actions). optz is React all the way
  down (pages are React components, not a separate template language), types routes and API
  responses end to end, and has ISR and revalidation built into its own server instead of
  depending on a hosting adapter.
- **Remix / React Router**: a server-first data model with full hydration; optz ships less
  JavaScript and makes static pages the default.
- **A static site generator**: as fast to serve, but no actions, API routes, dynamic pages or ISR.

(Only Next.js was measured here; the others are compared by design.)

## When to pick something else

- You need the React Server Components wire format, or a framework a large team already knows.
- You want managed hosting that integrates with the framework (Vercel, Netlify).
- You can't run Bun (the edge worker covers many cases, but the framework is built around Bun).

For a lab like this one, on a $1.50 server, the trade is easy: the whole site costs a few MB of
memory and a fraction of one core, leaving the box for the experiments.
