// Client for the OPTZ API, served under /api by nginx (or dev.mjs locally).
// Everything user-supplied is inserted with textContent, never as HTML.
const API = "/api";
const TOKEN_KEY = "optz.token";

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  n.append(...children);
  return n;
};

// ---- token -------------------------------------------------------------------------------

function decodeToken(t) {
  try {
    const payload = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(payload + "=".repeat((4 - (payload.length % 4)) % 4)));
    if (typeof json.username !== "string" || typeof json.exp !== "number") return null;
    return json;
  } catch {
    return null;
  }
}

function readToken() {
  let t = null;
  try {
    t = localStorage.getItem(TOKEN_KEY);
  } catch {}
  const claims = t && decodeToken(t);
  if (!claims) return null;
  return { token: t, claims, expired: claims.exp * 1000 <= Date.now() };
}

function saveToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

const auth = () => {
  const t = readToken();
  return t && !t.expired ? t : null;
};

// ---- API ---------------------------------------------------------------------------------

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  const t = auth();
  if (method !== "GET" && t) headers.Authorization = `Bearer ${t.token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = data?.error || `The server answered ${res.status}.`;
    const err = new Error(res.status === 401 ? `The server rejected your token (${msg}). Paste a new one.` : sentence(msg));
    err.status = res.status;
    throw err;
  }
  return { status: res.status, data };
}

const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");

// ---- formatting --------------------------------------------------------------------------

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "just now";
}

const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

function duration(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${plural(d, "day")} ${plural(h, "hour")}`;
  if (h) return `${plural(h, "hour")} ${plural(m, "minute")}`;
  if (m) return plural(m, "minute");
  return plural(sec, "second");
}

// ---- posts -------------------------------------------------------------------------------

function postItem(p) {
  const likes = el("span", { class: "text-sm text-muted tabular-nums", text: plural(p.like_count, "like") });
  const actions = el("div", { class: "mt-2.5 flex items-center gap-4" });
  if (auth()) {
    const btn = el("button", {
      class: "rounded border border-rule px-2.5 py-0.5 text-sm hover:border-ink aria-pressed:border-signal aria-pressed:text-ink",
      "aria-pressed": "false",
      text: "Like",
    });
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const { data } = await api(`/posts/${p.id}/like`, { method: "POST" });
        if (!data.already_liked) p.like_count += 1;
        likes.textContent = plural(p.like_count, "like");
        btn.textContent = "Liked";
        btn.setAttribute("aria-pressed", "true");
      } catch (e) {
        btn.disabled = false;
        likes.textContent = e.message;
      }
    });
    actions.append(btn);
  }
  actions.append(likes);
  return el(
    "li",
    { class: "py-5" },
    el(
      "div",
      { class: "flex items-baseline justify-between gap-4 text-sm" },
      el("span", { class: "font-medium", text: p.author }),
      el("a", { class: "text-muted hover:text-ink", href: `/social/post/?id=${p.id}` }, el("time", { datetime: p.created_at, text: ago(p.created_at) })),
    ),
    el("p", { class: "mt-1.5 max-w-[38rem] whitespace-pre-wrap break-words text-[1.05rem] leading-relaxed", text: p.body }),
    actions,
  );
}

function notice(list, text) {
  list.replaceChildren(el("li", { class: "py-5 text-muted", text }));
}

async function loadFeed(list) {
  const limit = Number(list.dataset.limit || 20);
  try {
    const { data } = await api("/feed");
    const posts = data.posts.slice(0, limit);
    if (!posts.length) return notice(list, "No posts yet. Add a token and write the first one.");
    list.replaceChildren(...posts.map(postItem));
  } catch (e) {
    notice(list, e.message);
  }
}

async function loadSingle(list) {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return notice(list, "This link is missing a post id. Pick a post from the feed.");
  try {
    const { data } = await api(`/posts/${encodeURIComponent(id)}`);
    list.replaceChildren(postItem(data.post));
    document.title = `${data.post.author}: ${data.post.body.slice(0, 50)}`;
  } catch (e) {
    notice(list, e.status === 404 ? "This post doesn't exist. It may have the wrong id." : e.message);
  }
}

// ---- token panel + compose --------------------------------------------------------------

function renderAuth(panel, compose) {
  const t = readToken();
  const fmt = (exp) => new Date(exp * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  compose.hidden = !(t && !t.expired);
  if (t && !t.expired) {
    const forget = el("button", { class: "text-muted underline decoration-rule underline-offset-4 hover:text-ink", text: "Forget token" });
    forget.addEventListener("click", () => {
      saveToken(null);
      renderAuth(panel, compose);
      document.querySelectorAll("[data-feed]").forEach(loadFeed);
    });
    panel.replaceChildren(
      el("p", { class: "flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" },
        el("span", {}, "Posting as ", el("strong", { class: "font-semibold", text: t.claims.username }), `. Your token expires ${fmt(t.claims.exp)}.`),
        forget),
    );
    return;
  }
  const input = el("textarea", {
    id: "token",
    rows: "2",
    class: "mt-2 block w-full rounded-md border border-rule bg-paper px-3 py-2 font-mono text-xs break-all focus:border-ink focus:outline-none",
    placeholder: "eyJhbGciOiJIUzI1NiIs…",
    spellcheck: "false",
    autocomplete: "off",
  });
  const error = el("p", { class: "mt-2 text-sm text-[#c2483d]", role: "alert" });
  if (t?.expired) error.textContent = `Your saved token expired on ${fmt(t.claims.exp)}. Paste a new one.`;
  const form = el(
    "form",
    {},
    el("label", { for: "token", class: "text-sm font-medium", text: "Paste a token to post and like" }),
    input,
    el("div", { class: "mt-2 flex flex-wrap items-center justify-between gap-3" },
      el("span", { class: "text-sm text-muted", text: "The site's owner signs tokens. Yours stays in this browser." }),
      el("button", { class: "rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90", text: "Use this token" })),
    error,
  );
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const value = input.value.trim().replace(/^Bearer\s+/i, "");
    const claims = decodeToken(value);
    if (!claims) return void (error.textContent = "That isn't a valid token. It should be three parts separated by dots.");
    if (claims.exp * 1000 <= Date.now()) return void (error.textContent = "That token has expired. Ask for a new one.");
    saveToken(value);
    renderAuth(panel, compose);
    document.querySelectorAll("[data-feed]").forEach(loadFeed);
  });
  panel.replaceChildren(form);
}

function setupCompose(compose) {
  const area = $("textarea", compose);
  const count = $("[data-count]", compose);
  const error = $("[data-compose-error]", compose);
  const button = $("button", compose);
  const update = () => {
    const n = [...area.value.trim()].length;
    count.textContent = `${n} of 500`;
    button.disabled = n === 0 || n > 500;
  };
  area.addEventListener("input", update);
  update();
  compose.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    error.textContent = "";
    button.disabled = true;
    button.textContent = "Posting";
    try {
      const { data } = await api("/posts", { method: "POST", body: { body: area.value } });
      area.value = "";
      const list = $("[data-feed]");
      list.querySelector("li.text-muted")?.remove();
      list.prepend(postItem(data.post));
    } catch (e) {
      error.textContent = e.message;
    } finally {
      button.textContent = "Post";
      update();
    }
  });
}

// ---- live server readout ------------------------------------------------------------------

async function pulse(box) {
  const dot = $("[data-pulse-dot]", box), state = $("[data-pulse-state]", box);
  const ms = $("[data-pulse-ms]", box), up = $("[data-pulse-uptime]", box);
  const t0 = performance.now();
  try {
    const res = await fetch(`${API}/health`, { cache: "no-store" });
    const took = performance.now() - t0;
    const data = await res.json();
    if (data.status !== "ok") throw new Error();
    dot.dataset.state = "live";
    state.textContent = "Live, timed from your browser";
    ms.textContent = `${took < 10 ? took.toFixed(1) : Math.round(took)} ms`;
    up.textContent = duration(data.uptime_s);
  } catch {
    dot.dataset.state = "down";
    state.textContent = "The server isn't answering right now";
    ms.textContent = "no time";
    up.textContent = "an unknown time";
  }
}

// ---- wire up -----------------------------------------------------------------------------

const box = $("[data-pulse]");
if (box) {
  pulse(box);
  setInterval(() => document.visibilityState === "visible" && pulse(box), 15000);
}
const panel = $("[data-auth]"), compose = $("[data-compose]");
if (panel && compose) {
  renderAuth(panel, compose);
  setupCompose(compose);
}
document.querySelectorAll("[data-feed]").forEach(loadFeed);
$("[data-refresh]")?.addEventListener("click", () => document.querySelectorAll("[data-feed]").forEach(loadFeed));
const single = $("[data-single]");
if (single) loadSingle(single);
