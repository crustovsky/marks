// Server-rendered pages. Everything here is plain HTML; static/app.js adds the
// few things that need a script.

import type { Child, FC } from "hono/jsx";
import type { Bookmark, Status } from "./db";

export interface Nav {
  title: string;
  counts: Record<Status, number>;
  tags: { tag: string; n: number }[];
}

const host = (url: string) => new URL(url).host.replace(/^www\./, "");

function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

// A steady colour per site for the letter tile.
function hue(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const Head: FC<{ title: string }> = ({ title }) => (
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0f1114" />
    <meta name="referrer" content="no-referrer" />
    <title>{title}</title>
    <link rel="stylesheet" href="/app.css" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <script src="/app.js" defer></script>
  </head>
);

export const Layout: FC<{ nav: Nav; active?: string; q?: string; children?: Child }> = ({ nav, active, q, children }) => {
  const views = [
    { id: "home", href: "/", label: "Home" },
    { id: "all", href: "/list", label: "All bookmarks", n: nav.counts.saved + nav.counts.later },
    { id: "later", href: "/list?view=later", label: "Read later", n: nav.counts.later },
    { id: "archived", href: "/list?view=archived", label: "Archive", n: nav.counts.archived },
  ];
  return (
    <html lang="en">
      <Head title={nav.title} />
      <body>
        <header class="top">
          <a class="brand" href="/">
            {nav.title}
          </a>
          <form class="search" action="/go" method="get" role="search">
            <input name="q" type="text" value={q ?? ""} placeholder="Search, or paste a URL to save it" aria-label="Search or paste a URL" autocomplete="off" autocapitalize="off" />
            <kbd>/</kbd>
          </form>
          <a class="btn primary" href="/add">
            Add
          </a>
        </header>
        <div class="shell">
          <nav class="side" aria-label="Views and tags">
            <div class="views">
              {views.map((v) => (
                <a href={v.href} class={v.id === active ? "active" : ""}>
                  <span>{v.label}</span>
                  {v.n !== undefined && <span class="n">{v.n}</span>}
                </a>
              ))}
              <a href="/settings" class={active === "settings" ? "active" : ""}>
                <span>Settings</span>
              </a>
            </div>
            <h2>Tags</h2>
            <TagCloud tags={nav.tags} />
          </nav>
          <main>{children}</main>
        </div>
        <nav class="bottom" aria-label="Main">
          <a href="/" class={active === "home" ? "active" : ""}>
            Home
          </a>
          <a href="/list" class={active === "all" ? "active" : ""}>
            All
          </a>
          <a href="/add" class="plus" aria-label="Add bookmark">
            +
          </a>
          <a href="/list?view=later" class={active === "later" ? "active" : ""}>
            Later
          </a>
          <a href="/tags" class={active === "tags" ? "active" : ""}>
            Tags
          </a>
        </nav>
      </body>
    </html>
  );
};

const TagCloud: FC<{ tags: Nav["tags"]; current?: string }> = ({ tags, current }) => (
  <div class="tags">
    {tags.map((t) => (
      <a class={t.tag === current ? "tag on" : "tag"} href={`/list?tag=${encodeURIComponent(t.tag)}`}>
        {t.tag} <span class="n">{t.n}</span>
      </a>
    ))}
  </div>
);

const Row: FC<{ b: Bookmark }> = ({ b }) => {
  const action = (status: Status, label: string) => (
    <button name="status" value={status}>
      {label}
    </button>
  );
  return (
    <li class="row">
      <div class="what">
        <a href={b.url} rel="noreferrer">
          {b.title || host(b.url)}
        </a>
        <span class="meta">
          {host(b.url)} · {ago(b.created_at)}
        </span>
      </div>
      <div class="tags">
        {b.tags.map((t) => (
          <a class="tag" href={`/list?tag=${encodeURIComponent(t)}`}>
            {t}
          </a>
        ))}
      </div>
      <form class="actions" method="post" action={`/b/${b.id}/status`}>
        {b.status === "later" && action("archived", "Done")}
        {b.status === "later" && action("saved", "Keep")}
        {b.status === "saved" && action("later", "Later")}
        {b.status === "archived" && action("saved", "Restore")}
        <a href={`/edit/${b.id}`}>Edit</a>
      </form>
    </li>
  );
};

const Rows: FC<{ items: Bookmark[]; empty: string }> = ({ items, empty }) =>
  items.length ? (
    <ul class="rows">
      {items.map((b) => (
        <Row b={b} />
      ))}
    </ul>
  ) : (
    <p class="empty">{empty}</p>
  );

export const Home: FC<{ nav: Nav; pinned: Bookmark[]; later: Bookmark[]; recent: Bookmark[] }> = ({ nav, pinned, later, recent }) => (
  <Layout nav={nav} active="home">
    <section>
      <div class="head">
        <h2>Quick access</h2>
        {pinned.length > 0 && (
          <button id="quick-edit" class="link">
            Edit
          </button>
        )}
      </div>
      {pinned.length ? (
        <div class="tiles" id="quick">
          {pinned.map((b) => (
            <div class="tile" data-id={b.id}>
              <a href={b.url} rel="noreferrer">
                {b.icon ? (
                  <img class="letter" src={`/icon/${b.id}?v=${b.icon}`} alt="" />
                ) : (
                  <span class="letter" style={`background:hsl(${hue(host(b.url))} 45% 36%)`}>
                    {(b.title || host(b.url)).trim()[0]?.toUpperCase()}
                  </span>
                )}
                <span class="name">{b.title || host(b.url)}</span>
              </a>
              <form method="post" action={`/b/${b.id}/icon`} class="refresh">
                <button aria-label={`Fetch the icon of ${b.title} again`}>↻</button>
              </form>
              <form method="post" action={`/b/${b.id}/unpin`}>
                <button aria-label={`Remove ${b.title} from quick access`}>×</button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p class="empty">Nothing pinned yet. Tick "Quick access" when you save or edit a bookmark.</p>
      )}
    </section>
    {later.length > 0 && (
      <section>
        <div class="head">
          <h2>Read later</h2>
          <a href="/list?view=later">All {nav.counts.later}</a>
        </div>
        <Rows items={later} empty="" />
      </section>
    )}
    <section>
      <div class="head">
        <h2>Recently added</h2>
        <a href="/list">All</a>
      </div>
      <Rows items={recent} empty="No bookmarks yet. Paste a URL into the box above, or import your browser's bookmarks under Settings." />
    </section>
  </Layout>
);

export const List: FC<{ nav: Nav; active: string; heading: string; items: Bookmark[]; q?: string; tag?: string }> = (p) => (
  <Layout nav={p.nav} active={p.active} q={p.q}>
    <section>
      <div class="head">
        <h2>{p.heading}</h2>
        <span class="n">{p.items.length}</span>
      </div>
      <div class="strip">
        <TagCloud tags={p.nav.tags} current={p.tag} />
      </div>
      <Rows items={p.items} empty="Nothing here." />
    </section>
  </Layout>
);

export const Tags: FC<{ nav: Nav }> = ({ nav }) => (
  <Layout nav={nav} active="tags">
    <section>
      <div class="head">
        <h2>Tags</h2>
      </div>
      {nav.tags.length ? <TagCloud tags={nav.tags} /> : <p class="empty">No tags yet.</p>}
    </section>
  </Layout>
);

export interface FormValues {
  id?: number;
  url: string;
  title: string;
  note: string;
  tags: string[];
  pin: boolean;
  later: boolean;
  strip: boolean;
}

export const Form: FC<{ nav: Nav; v: FormValues; popup: boolean; suggest: boolean; message?: string }> = ({ nav, v, popup, suggest, message }) => {
  const body = (
    <section class="form">
      <div class="head">
        <h1>{v.id ? "Edit bookmark" : "Add bookmark"}</h1>
      </div>
      {message && <p class="note">{message}</p>}
      <form method="post" action="/save" id="save">
        {v.id && <input type="hidden" name="id" value={v.id} />}
        {popup && <input type="hidden" name="popup" value="1" />}
        <label>
          URL
          <input name="url" type="text" inputmode="url" value={v.url} required autocapitalize="off" autocomplete="off" class="mono" />
        </label>
        <label>
          Title
          <input name="title" type="text" value={v.title} placeholder="Read from the page when left empty" />
        </label>
        <label>
          Tags
          <input name="tags" id="tags" type="text" value={v.tags.join(" ")} placeholder="separated by spaces" autocapitalize="off" autocomplete="off" class="mono" data-suggest={suggest ? "1" : undefined} />
        </label>
        <div class="tags pick" id="pick">
          {nav.tags.slice(0, 24).map((t) => (
            <button type="button" class="tag" data-tag={t.tag}>
              {t.tag}
            </button>
          ))}
        </div>
        <label>
          Note
          <input name="note" type="text" value={v.note} />
        </label>
        <div class="checks">
          <label>
            <input type="checkbox" name="pin" checked={v.pin} /> Quick access
          </label>
          <label>
            <input type="checkbox" name="later" checked={v.later} /> Read later
          </label>
          <label>
            <input type="checkbox" name="strip" checked={v.strip} /> Strip tracking
          </label>
        </div>
      </form>
      <div class="buttons">
        {v.id && (
          <form method="post" action={`/b/${v.id}/delete`} data-confirm="Delete this bookmark?">
            {popup && <input type="hidden" name="popup" value="1" />}
            <button class="btn danger">Delete</button>
          </form>
        )}
        <span class="grow"></span>
        <a class="btn" href="/" data-close={popup ? "1" : undefined}>
          Cancel
        </a>
        <button class="btn primary" form="save">
          Save
        </button>
      </div>
    </section>
  );
  if (!popup) return <Layout nav={nav}>{body}</Layout>;
  return (
    <html lang="en">
      <Head title={nav.title} />
      <body class="popup">
        <main>{body}</main>
      </body>
    </html>
  );
};

// Shown in the bookmarklet's window after a save: closes it, or goes home when it cannot.
export const Closing: FC<{ title: string }> = ({ title }) => (
  <html lang="en">
    <Head title={title} />
    <body class="popup" data-done="1">
      <main>
        <p class="empty">
          Saved. <a href="/">Open {title}</a>
        </p>
      </main>
    </body>
  </html>
);

export const Settings: FC<{ nav: Nav; origin: string; tagger: boolean; message?: string }> = ({ nav, origin, tagger, message }) => {
  const bookmarklet = `javascript:(()=>{window.open('${origin}/add?popup=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'marks','width=480,height=640')})()`;
  return (
    <Layout nav={nav} active="settings">
      {message && <p class="note">{message}</p>}
      <section>
        <div class="head">
          <h2>Bookmarklet</h2>
        </div>
        <p>
          Drag this to your bookmarks bar, then click it on any page to save it:{" "}
          <a class="btn" href={bookmarklet}>
            + {nav.title}
          </a>
        </p>
      </section>
      <section>
        <div class="head">
          <h2>Import</h2>
        </div>
        <p>Upload the bookmarks HTML file your browser exports. Folders become tags, and bookmarks you already have only gain tags.</p>
        <form method="post" action="/import" enctype="multipart/form-data" class="inline">
          <input type="file" name="file" accept=".html,.htm,text/html" required aria-label="Bookmarks file" />
          <button class="btn primary">Import</button>
        </form>
      </section>
      <section>
        <div class="head">
          <h2>Export</h2>
        </div>
        <p>
          <a class="btn" href="/api/export" download="marks.json">
            Download everything as JSON
          </a>
        </p>
      </section>
      <section>
        <div class="head">
          <h2>Tag suggestions</h2>
        </div>
        <p>{tagger ? "On. New bookmarks get suggested tags from the Claude API." : "Off. Set the ANTHROPIC_API_KEY secret on the Worker to turn them on."}</p>
      </section>
    </Layout>
  );
};
