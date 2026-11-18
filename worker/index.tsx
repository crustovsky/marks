import { Hono } from "hono";
import type { Context } from "hono";
import { csrf } from "hono/csrf";
import { html } from "hono/html";
import { HTTPException } from "hono/http-exception";
import sortable from "sortablejs/Sortable.min.js";
import { loadConfig } from "./config";
import type { Config } from "./config";
import * as db from "./db";
import type { Status } from "./db";
import { fetchIcon, fetchPage } from "./page";
import { ensureSchema } from "./schema";
import script from "./static/app.js";
import importer from "./static/import.js";
import styles from "./static/app.css";
import { suggestTags, suggestTagsBulk } from "./tagger";
import { cleanTags, cleanUrl, folderTags, looksLikeUrl, parseUrl } from "./url";
import { Closing, ConfirmDelete, Form, Home, List, Settings, Tags } from "./views";
import type { FormValues, Nav } from "./views";

type App = { Bindings: Env; Variables: { cfg: Config } };
type Ctx = Context<App>;

const app = new Hono<App>();

// Private, always: only requests that Cloudflare Access authenticated are served.
// There is no switch to turn this off, because every visitor can edit and delete.
app.use(async (c, next) => {
  // Hono types its own ExecutionContext, which does not know about Access yet.
  const ctx = c.executionCtx as unknown as ExecutionContext;
  if (!ctx.access) return accessRequired();
  c.set("cfg", loadConfig(c.env));
  await next();
});

// Forms only post from this origin.
app.use(csrf());

// Pages load scripts, styles and images from this origin only, post only to it
// and cannot be framed. The icon route sets a stricter policy of its own.
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
app.use(async (c, next) => {
  await next();
  if (!c.res.headers.has("content-security-policy")) c.res.headers.set("content-security-policy", CSP);
  c.res.headers.set("x-content-type-options", "nosniff");
});

// The stylesheet and scripts live in the Worker bundle, see wrangler.jsonc.
const asset = (body: string, type: string) => () =>
  new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "private, max-age=600" } });

app.get("/app.css", asset(styles, "text/css"));
app.get("/app.js", asset(script, "text/javascript"));
app.get("/import.js", asset(importer, "text/javascript"));
app.get("/sortable.js", asset(sortable, "text/javascript"));
app.get(
  "/icon.svg",
  asset(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f1114"/><path d="M20 12h24v40L32 42 20 52z" fill="#e8a33d"/></svg>`,
    "image/svg+xml",
  ),
);
app.get("/manifest.webmanifest", (c) =>
  c.json({
    name: c.var.cfg.title,
    short_name: c.var.cfg.title,
    start_url: "/",
    display: "standalone",
    background_color: "#0f1114",
    theme_color: "#0f1114",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    // Android: "Share" from any app opens the add form.
    share_target: { action: "/add", method: "GET", params: { title: "title", text: "text", url: "url" } },
  }),
);

app.use(async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

const page = (c: Ctx, node: unknown, status: 200 | 400 | 404 = 200) => c.html(html`<!doctype html>${node}`, status);

async function nav(c: Ctx): Promise<Nav> {
  const [counts, tags] = await Promise.all([db.counts(c.env.DB), db.tagCounts(c.env.DB)]);
  return { title: c.var.cfg.title, counts, tags };
}

// Back to where the form was posted from, as long as that is this site.
function back(c: Ctx): Response {
  const ref = c.req.header("referer");
  const here = new URL(c.req.url);
  const to = ref && URL.canParse(ref) && new URL(ref).host === here.host ? ref : "/";
  return c.redirect(to, 303);
}

app.get("/", async (c) => {
  const [n, pinned, notes, later, recent] = await Promise.all([
    nav(c),
    db.pinned(c.env.DB),
    db.notes(c.env.DB, false),
    db.list(c.env.DB, { status: "later", limit: 5 }),
    db.list(c.env.DB, { status: "saved", limit: 10 }),
  ]);
  return page(c, <Home nav={n} pinned={pinned} notes={notes} later={later} recent={recent} />);
});

// The box in the top bar: an address is something to save, anything else a search.
app.get("/go", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  // Searching from a tag's list stays inside that tag.
  const tag = c.req.query("tag");
  if (!q) return c.redirect(tag ? `/list?tag=${encodeURIComponent(tag)}` : "/list");
  if (looksLikeUrl(q)) return c.redirect(`/add?url=${encodeURIComponent(q)}`);
  return c.redirect(`/list?${new URLSearchParams(tag ? { q, tag } : { q })}`);
});

const PAGE = 200; // bookmarks per list page

// What a list shows. Read from the list's address, and again from the hidden
// fields of the select bar, so "apply to all" reaches what the list showed.
const FILTER_KEYS = ["view", "tag", "q", "untagged", "suggested"] as const;

function filterOf(get: (key: string) => string | undefined): db.Filter {
  const view = get("view");
  return {
    status: view === "later" || view === "archived" ? view : undefined,
    tag: get("tag") || undefined,
    q: get("q") || undefined,
    untagged: get("untagged") === "1" || undefined,
    suggested: get("suggested") === "1" || undefined,
  };
}

// What the select bar did last, for the line above the list.
function notice(did: string | undefined, n: number): string | undefined {
  const what = `${n} ${n === 1 ? "bookmark" : "bookmarks"}`;
  switch (did) {
    case "none":
      return "Nothing was ticked, so nothing changed. Tick some rows first.";
    case "later":
      return `Moved ${what} to Read later.`;
    case "saved":
      return `Moved ${what} to Bookmarks.`;
    case "archived":
      return `Moved ${what} to the Archive.`;
    case "tag":
      return `Added tags to ${what}.`;
    case "untag":
    case "drop":
      return `Removed tags from ${what}.`;
    case "keep":
      return `Kept the suggested tags of ${what}.`;
    case "reject":
      return `Removed the suggested tags of ${what}.`;
    case "delete":
      return `Deleted ${what}.`;
  }
}

app.get("/list", async (c) => {
  const f = filterOf((k) => c.req.query(k));
  const { status, tag, q } = f;
  const archive = status === "archived" && !tag && !q;
  // One row more than a page holds tells whether there is an older page.
  const pageNo = Math.max(1, Number(c.req.query("page")) || 1);
  const [n, rows, notes, total] = await Promise.all([
    nav(c),
    db.list(c.env.DB, { ...f, limit: PAGE + 1, offset: (pageNo - 1) * PAGE }),
    archive && pageNo === 1 ? db.notes(c.env.DB, true) : [],
    db.count(c.env.DB, f),
  ]);
  const items = rows.slice(0, PAGE);
  // The outcome of the select bar rides on the address once and is not carried further.
  const here = new URLSearchParams(c.req.query());
  const said = notice(here.get("did") ?? undefined, Number(here.get("n")) || 0);
  here.delete("did");
  here.delete("n");
  const link = (p: number) => `/list?${new URLSearchParams({ ...Object.fromEntries(here), page: String(p) })}`;
  const newer = pageNo > 1 ? link(pageNo - 1) : undefined;
  const older = rows.length > PAGE ? link(pageNo + 1) : undefined;
  const where = f.untagged ? "Untagged" : f.suggested ? "Suggested tags" : status === "later" ? "Read later" : status === "archived" ? "Archive" : "All bookmarks";
  const heading = q ? `Search: ${q}${tag ? ` in ${tag}` : ""}` : tag ? `Tag: ${tag}` : where;
  const active = q || tag ? "" : f.untagged ? "untagged" : f.suggested ? "suggested" : (status ?? "all");
  // Select mode: rows get tick boxes and the page a bar of changes for the ticked ones.
  const selecting = here.get("select") === "1";
  const fields = FILTER_KEYS.flatMap((k) => (here.get(k) ? [[k, here.get(k)!] as [string, string]] : []));
  const select = selecting ? { ret: `/list?${here}`, fields } : undefined;
  if (selecting) here.delete("select");
  else here.set("select", "1");
  return page(
    c,
    <List
      nav={n}
      active={active}
      heading={heading}
      items={items}
      notes={notes}
      q={q}
      tag={tag}
      first={(pageNo - 1) * PAGE + 1}
      total={total}
      marks={!status}
      notice={said}
      newer={newer}
      older={older}
      toggle={`/list?${here}`}
      select={select}
    />,
  );
});

// The bar in select mode. Changes the ticked bookmarks, or with "apply to all"
// everything the list's filter finds, on every page of it.
app.post("/bulk", async (c) => {
  const f = await c.req.parseBody({ all: true });
  const many = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String);
  const one = (v: unknown) => many(v)[0] ?? "";
  // Back to the list the bar was on, never to another site.
  const ret = one(f.ret).startsWith("/list") ? one(f.ret) : "/list";
  const done = (did: string, n: number) => c.redirect(`${ret}${ret.includes("?") ? "&" : "?"}${new URLSearchParams({ did, n: String(n) })}`, 303);
  const filter = filterOf((k) => one(f[k]) || undefined);
  const ids = one(f.ids)
    ? one(f.ids).split(",").map(Number)
    : one(f.all) === "1"
      ? await db.ids(c.env.DB, filter)
      : many(f.id).map(Number);
  const picked = ids.filter(Number.isInteger);
  const action = one(f.do);
  if (!picked.length) return done("none", 0);
  if (action === "later" || action === "saved" || action === "archived") {
    await db.setStatus(c.env.DB, picked, action);
  } else if (action === "tag" || action === "untag") {
    const tags = cleanTags(one(f.tags));
    if (!tags.length) return c.redirect(ret, 303);
    await db.tagMany(c.env.DB, picked, tags, action === "tag");
  } else if (action === "drop") {
    // The button that names the tag of the list it is on.
    if (!filter.tag) return c.redirect(ret, 303);
    await db.tagMany(c.env.DB, picked, [filter.tag], false);
  } else if (action === "keep" || action === "reject") {
    await db.settleAuto(c.env.DB, picked, action === "keep");
  } else if (action === "delete") {
    // Deleting cannot be undone, so it asks first, on a page of its own that works without a script.
    if (one(f.confirm) !== "1") return page(c, <ConfirmDelete nav={await nav(c)} ids={picked} ret={ret} />);
    await db.remove(c.env.DB, picked);
  } else {
    return c.redirect(ret, 303);
  }
  return done(action, picked.length);
});

// The form on a tag's page: a new name for the tag. Naming a tag that exists merges the two.
app.post("/tag", async (c) => {
  const f = await c.req.parseBody();
  const to = cleanTags(String(f.to ?? ""))[0];
  if (!f.tag || !to) return back(c);
  await db.renameTag(c.env.DB, String(f.tag), to);
  return c.redirect(`/list?tag=${encodeURIComponent(to)}`, 303);
});

app.get("/tags", async (c) => page(c, <Tags nav={await nav(c)} />));

const fromBookmark = (b: db.Bookmark): FormValues => ({
  id: b.id,
  url: b.url,
  title: b.title,
  note: b.note,
  tags: b.tags,
  pin: b.pinned_pos !== null,
  later: b.status === "later",
  strip: false, // it was cleaned, or deliberately not, when it was first saved
});

// Opened by the search box, the bookmarklet (popup=1) and the Android share sheet.
app.get("/add", async (c) => {
  const q = c.req.query();
  const raw = q.url || q.text?.match(/https?:\/\/\S+/)?.[0] || "";
  const url = raw ? parseUrl(raw) : null;
  const existing = url ? await db.byUrl(c.env.DB, url) : null;
  const v: FormValues = existing
    ? fromBookmark(existing)
    : { url: url?.href ?? raw, title: q.title ?? "", note: "", tags: [], pin: false, later: false, strip: true };
  const message = existing ? "Already saved. Saving again updates it." : undefined;
  return page(c, <Form nav={await nav(c)} v={v} popup={q.popup === "1"} suggest={!!c.var.cfg.apiKey && !existing && !!url} message={message} />);
});

app.get("/edit/:id", async (c) => {
  const b = await db.byId(c.env.DB, Number(c.req.param("id")));
  if (!b) return c.notFound();
  return page(c, <Form nav={await nav(c)} v={fromBookmark(b)} popup={false} suggest={false} />);
});

app.post("/save", async (c) => {
  const f = await c.req.parseBody();
  const popup = f.popup === "1";
  const v: FormValues = {
    id: Number(f.id) || undefined,
    url: String(f.url ?? "").trim(),
    title: String(f.title ?? "").trim(),
    note: String(f.note ?? "").trim(),
    tags: cleanTags(String(f.tags ?? "")),
    pin: f.pin === "on",
    later: f.later === "on",
    strip: f.strip === "on",
  };
  const fail = async (message: string) => page(c, <Form nav={await nav(c)} v={v} popup={popup} suggest={false} message={message} />, 400);

  const url = parseUrl(v.url);
  if (!url) return fail("That does not look like a web address.");
  if (!v.title) v.title = (await fetchPage(url.href)).title;
  const id = await db.save(c.env.DB, {
    id: v.id,
    url,
    strip: v.strip,
    title: v.title,
    note: v.note,
    // An edit sets the status; a second save of a known address keeps it,
    // except that an archived bookmark comes back (see db.save).
    status: v.later ? "later" : v.id ? "saved" : undefined,
    // Without an id this is a new bookmark, or a second save of one that is
    // already there: then tags are merged and an unticked box unpins nothing.
    pin: v.id ? v.pin : v.pin || undefined,
    tags: v.tags,
    replaceTags: !!v.id,
  });
  if (id === null) return fail("Another bookmark already has this address.");
  // A pinned bookmark gets its site icon; the tile shows a letter until it is there.
  if (v.pin) c.executionCtx.waitUntil(loadIcon(c.env.DB, id, false));
  return popup ? page(c, <Closing title={c.var.cfg.title} />) : c.redirect("/", 303);
});

app.post("/b/:id/status", async (c) => {
  const status = String((await c.req.parseBody()).status);
  if (status !== "saved" && status !== "later" && status !== "archived") return c.text("bad status", 400);
  await db.setStatus(c.env.DB, [Number(c.req.param("id"))], status as Status);
  return back(c);
});

// Fetches the site icon for a bookmark. Without `again`, only when it has none yet.
async function loadIcon(d1: D1Database, id: number, again: boolean): Promise<void> {
  const b = await db.byId(d1, id);
  if (!b || (b.icon && !again)) return;
  for (const candidate of (await fetchPage(b.url)).icons) {
    const icon = await fetchIcon(candidate);
    if (icon) return db.setIcon(d1, id, icon.type, icon.data);
  }
}

// The refresh button on a quick access tile.
app.post("/b/:id/icon", async (c) => {
  await loadIcon(c.env.DB, Number(c.req.param("id")), true);
  return back(c);
});

// Icons come from other sites, so they are served as images and nothing else:
// an SVG opened directly must not run as a page of this origin.
app.get("/icon/:id", async (c) => {
  const icon = await db.getIcon(c.env.DB, Number(c.req.param("id")));
  if (!icon) return c.notFound();
  return new Response(icon.data, {
    headers: {
      "content-type": icon.type,
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
});

app.post("/b/:id/unpin", async (c) => {
  await db.unpin(c.env.DB, Number(c.req.param("id")));
  return back(c);
});

app.post("/b/:id/delete", async (c) => {
  await db.remove(c.env.DB, [Number(c.req.param("id"))]);
  const popup = (await c.req.parseBody()).popup === "1";
  return popup ? page(c, <Closing title={c.var.cfg.title} />) : c.redirect("/", 303);
});

// Quick notes: added from the home page, done moves them to the archive.

const NOTE_MAX = 2000;

app.post("/note", async (c) => {
  const text = String((await c.req.parseBody()).text ?? "").trim().slice(0, NOTE_MAX);
  if (text) await db.addNote(c.env.DB, text);
  return back(c);
});

app.post("/n/:id/done", async (c) => {
  const done = (await c.req.parseBody()).done === "1";
  await db.setNoteDone(c.env.DB, Number(c.req.param("id")), done);
  return back(c);
});

app.post("/n/:id/delete", async (c) => {
  await db.removeNote(c.env.DB, Number(c.req.param("id")));
  return back(c);
});

app.get("/settings", async (c) =>
  page(c, <Settings nav={await nav(c)} origin={new URL(c.req.url).origin} tagger={!!c.var.cfg.apiKey} />),
);

// JSON API. Same Access gate as the pages; scripts and the iOS Shortcut use a service token.

app.post("/api/reorder", async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) return c.json({ error: "ids must be a list of numbers" }, 400);
  await db.reorder(c.env.DB, ids);
  return c.json({ ok: true });
});

app.get("/api/suggest", async (c) => {
  const { url = "", title = "" } = c.req.query();
  const existing = (await db.tagCounts(c.env.DB)).map((t) => t.tag);
  return c.json({ tags: await suggestTags(c.var.cfg, { url, title }, existing) });
});

// Saves without a form: { url, title?, tags?, later?, strip? }. Without tags, the
// tagger adds its own after the response has gone out.
app.post("/api/add", async (c) => {
  const body = await c.req.json<{ url?: string; title?: string; tags?: string[] | string; later?: boolean; strip?: boolean }>();
  const url = parseUrl(String(body.url ?? ""));
  if (!url) return c.json({ error: "url is missing or not a web address" }, 400);
  const tags = cleanTags(body.tags ?? []);
  const info = body.title ? { title: body.title, description: "" } : await fetchPage(url.href);
  const strip = body.strip !== false;
  const id = await db.save(c.env.DB, {
    url,
    strip,
    title: info.title,
    status: body.later ? "later" : undefined,
    tags,
    replaceTags: false,
  });
  if (id !== null && !tags.length && c.var.cfg.apiKey) {
    c.executionCtx.waitUntil(
      (async () => {
        const existing = (await db.tagCounts(c.env.DB)).map((t) => t.tag);
        const auto = await suggestTags(c.var.cfg, { url: url.href, ...info }, existing);
        await db.addTags(c.env.DB, id, auto, true);
      })(),
    );
  }
  return c.json({ id, url: cleanUrl(url, strip), title: info.title });
});

// One batch of a bookmarks import. The Settings page reads the file in the
// browser and sends the links here: { items: [{ url, title, folders, created }] }.
app.post("/api/import", async (c) => {
  const { items } = await c.req.json<{ items?: { url?: unknown; title?: unknown; folders?: unknown; created?: unknown }[] }>();
  if (!Array.isArray(items) || items.length > 500) return c.json({ error: "items must be a list of at most 500" }, 400);
  const added = await db.importAll(
    c.env.DB,
    items.map((it) => ({
      url: String(it.url ?? ""),
      title: String(it.title ?? "").slice(0, 300),
      tags: folderTags(Array.isArray(it.folders) ? it.folders.map(String) : []),
      created: Number(it.created) || 0,
    })),
  );
  return c.json({ added });
});

// Tags one batch of bookmarks that have no tags, with a single call to the model.
// The Settings page calls this until nothing is left: { after } is the last id
// of the batch before, so a bookmark the model had nothing for is not asked about again.
const TAG_BATCH = 50;

app.post("/api/tag", async (c) => {
  if (!c.var.cfg.apiKey) return c.json({ error: "tag suggestions are off" }, 400);
  const body = await c.req.json<{ after?: unknown }>().catch(() => ({ after: 0 }));
  const after = Number(body.after) || 0;
  const [{ items, left }, counts] = await Promise.all([db.untagged(c.env.DB, after, TAG_BATCH), db.tagCounts(c.env.DB)]);
  if (!items.length) return c.json({ asked: 0, tagged: 0, next: after, left: 0 });
  const tags = await suggestTagsBulk(c.var.cfg, items, counts.map((t) => t.tag));
  if (!tags) return c.json({ error: "the tagger did not answer" }, 502);
  await db.addAutoTags(c.env.DB, tags);
  return c.json({ asked: items.length, tagged: tags.length, next: items[items.length - 1].id, left: left - items.length });
});

// { text }: a quick note from a script or the iOS Shortcut.
app.post("/api/note", async (c) => {
  const text = String((await c.req.json<{ text?: string }>()).text ?? "").trim().slice(0, NOTE_MAX);
  if (!text) return c.json({ error: "text is missing" }, 400);
  return c.json({ id: await db.addNote(c.env.DB, text) });
});

app.get("/api/export", async (c) => {
  const [bookmarks, open, done] = await Promise.all([db.exportAll(c.env.DB), db.notes(c.env.DB, false), db.notes(c.env.DB, true)]);
  return c.json({ bookmarks, notes: [...open, ...done] });
});

app.onError((e, c) => {
  if (e instanceof HTTPException) return e.getResponse();
  console.error(JSON.stringify({ message: "request failed", path: new URL(c.req.url).pathname, error: e.message }));
  return c.text("Something went wrong.", 500);
});

function accessRequired(): Response {
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Private</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}</style>
</head><body>
<h1>These bookmarks are private</h1>
<p>Cloudflare Access is not protecting this address yet, so nothing is shown.</p>
<h2>If you deployed this Worker, turn Access on</h2>
<p>Workers &amp; Pages → <em>this Worker</em> → <strong>Access</strong> tab → <strong>Protect this Worker behind Access</strong> → <strong>All traffic</strong> (the default, Previews only, is not enough), choose who may sign in, then <strong>Apply Access</strong>.</p>
</body></html>`;
  return new Response(page, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default app;
