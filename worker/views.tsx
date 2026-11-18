// Server-rendered pages. Everything here is plain HTML; static/app.js adds the
// few things that need a script.

import type { Child, FC } from "hono/jsx";
import type { Bookmark, Counts, Note, Status } from "./db";

export interface Nav {
  title: string;
  counts: Counts;
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
    <meta name="referrer" content="same-origin" />
    <title>{title}</title>
    <link rel="stylesheet" href="/app.css" />
    <link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <script src="/app.js" defer></script>
  </head>
);

// `tag` is the tag whose list this is: the search box then searches inside it.
export const Layout: FC<{ nav: Nav; active?: string; q?: string; tag?: string; children?: Child }> = ({ nav, active, q, tag, children }) => {
  const views = [
    { id: "home", href: "/", label: "Home" },
    { id: "all", href: "/list", label: "All bookmarks", n: nav.counts.saved + nav.counts.later },
    { id: "later", href: "/list?view=later", label: "Read later", n: nav.counts.later },
    { id: "archived", href: "/list?view=archived", label: "Archive", n: nav.counts.archived },
    // Two lists for cleaning up, shown while there is something in them.
    ...(nav.counts.untagged ? [{ id: "untagged", href: "/list?untagged=1", label: "Untagged", n: nav.counts.untagged }] : []),
    ...(nav.counts.suggested ? [{ id: "suggested", href: "/list?suggested=1", label: "Suggested tags", n: nav.counts.suggested }] : []),
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
            {tag && <input type="hidden" name="tag" value={tag} />}
            <input
              name="q"
              type="text"
              value={q ?? ""}
              placeholder={tag ? `Search in ${tag}, or paste a URL to save it` : "Search, or paste a URL to save it"}
              aria-label="Search or paste a URL"
              autocomplete="off"
              autocapitalize="off"
            />
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
          <main>
            {children}
            {/* Phones have no sidebar; this is how they reach what the bottom bar leaves out. */}
            <nav class="more" aria-label="More">
              {views.slice(3).map((v) => (
                <a href={v.href}>
                  {v.label} <span class="n">{v.n}</span>
                </a>
              ))}
              <a href="/settings">Settings</a>
            </nav>
          </main>
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

// In select mode a row has a tick box instead of its own buttons. The box
// belongs to the bulk form above the list through its form attribute.
// `marks` says where a bookmark is when the list mixes them; `hide` is the tag
// the whole list shares, which need not be repeated on every row.
const Row: FC<{ b: Bookmark; select?: boolean; marks?: boolean; hide?: string }> = ({ b, select, marks, hide }) => {
  const action = (status: Status, label: string) => (
    <button name="status" value={status}>
      {label}
    </button>
  );
  return (
    <li class="row">
      {select && (
        <label class="tick">
          <input type="checkbox" name="id" value={b.id} form="bulk" aria-label={`Select ${b.title || host(b.url)}`} />
        </label>
      )}
      <div class="what">
        <a href={b.url} rel="noreferrer">
          {b.title || host(b.url)}
        </a>
        <span class="meta">
          {host(b.url)} · {ago(b.created_at)}
          {marks && b.status === "later" && <span class="where"> · read later</span>}
        </span>
      </div>
      <div class="tags">
        {b.tags
          .filter((t) => t !== hide)
          .map((t) => (
            <a class={b.auto.includes(t) ? "tag suggested" : "tag"} title={b.auto.includes(t) ? "Suggested by the tagger" : undefined} href={`/list?tag=${encodeURIComponent(t)}`}>
              {t}
            </a>
          ))}
      </div>
      {!select && (
        <form class="actions" method="post" action={`/b/${b.id}/status`}>
          {b.status === "later" && action("archived", "Done")}
          {b.status === "later" && action("saved", "Keep")}
          {b.status === "saved" && action("later", "Later")}
          {b.status === "archived" && action("saved", "Restore")}
          <a href={`/edit/${b.id}`}>Edit</a>
        </form>
      )}
    </li>
  );
};

const Rows: FC<{ items: Bookmark[]; empty: string; select?: boolean; marks?: boolean; hide?: string }> = ({ items, empty, select, marks, hide }) =>
  items.length ? (
    <ul class="rows">
      {items.map((b) => (
        <Row b={b} select={select} marks={marks} hide={hide} />
      ))}
    </ul>
  ) : (
    <p class="empty">{empty}</p>
  );

// Note text with its addresses turned into links.
const Linked: FC<{ text: string }> = ({ text }) => (
  <span class="text">
    {text.split(/(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/).map((part, i) =>
      i % 2 ? (
        <a href={part} rel="noreferrer">
          {part}
        </a>
      ) : (
        part
      ),
    )}
  </span>
);

const Notes: FC<{ items: Note[] }> = ({ items }) => (
  <ul class="rows">
    {items.map((n) => (
      <li class="row">
        <div class="what">
          <Linked text={n.text} />
          <span class="meta">{ago(n.done_at ?? n.created_at)}</span>
        </div>
        <form class="actions" method="post" action={`/n/${n.id}/done`}>
          {n.done_at ? (
            <button name="done" value="0">
              Restore
            </button>
          ) : (
            <button name="done" value="1">
              Done
            </button>
          )}
          {n.done_at && <button formaction={`/n/${n.id}/delete`}>Delete</button>}
        </form>
      </li>
    ))}
  </ul>
);

export const Home: FC<{ nav: Nav; pinned: Bookmark[]; notes: Note[]; later: Bookmark[]; recent: Bookmark[] }> = ({ nav, pinned, notes, later, recent }) => (
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
    <section>
      <div class="head">
        <h2>Quick notes</h2>
      </div>
      <form method="post" action="/note" class="add-note">
        <input name="text" type="text" required maxlength={2000} placeholder="Jot something down" aria-label="Quick note" autocomplete="off" />
        <button class="btn">Add</button>
      </form>
      {notes.length > 0 && <Notes items={notes} />}
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

export interface Selecting {
  ret: string; // this list, to come back to
  fields: [string, string][]; // the list's filter, for "apply to all"
}

// The bar of select mode. The tags come first so that Enter in their field adds
// tags; a browser submits a form with its first button.
const Bulk: FC<{ s: Selecting; shown: number; total: number; tag?: string; auto: boolean }> = ({ s, shown, total, tag, auto }) => (
  <form id="bulk" class="bulk" method="post" action="/bulk">
    <input type="hidden" name="ret" value={s.ret} />
    {s.fields.map(([name, value]) => (
      <input type="hidden" name={name} value={value} />
    ))}
    <div class="inline">
      <button type="button" class="btn" id="tick-all" hidden>
        {total > shown ? "Tick all on this page" : "Tick all"}
      </button>
      <span class="meta" id="ticked" role="status" hidden></span>
      {/* A list longer than one page: this reaches the rows that are not on screen.
          On a single page it only stands in for the button above when scripts are off. */}
      <label data-one-page={total > shown ? undefined : "1"}>
        <input type="checkbox" name="all" value="1" data-total={total} />{" "}
        {total > shown ? `Apply to all ${total} in this list, including the ${total - shown} on other pages` : `Apply to all ${total} in this list`}
      </label>
    </div>
    <div class="inline">
      <input type="text" name="tags" placeholder="tags" aria-label="Tags" autocapitalize="off" />
      <button class="btn" name="do" value="tag">
        Add tags
      </button>
      <button class="btn" name="do" value="untag">
        Remove tags
      </button>
      {tag && (
        <button class="btn" name="do" value="drop">
          Remove tag {tag}
        </button>
      )}
    </div>
    {auto && (
      <div class="inline">
        <span class="meta">Suggested tags</span>
        <button class="btn" name="do" value="keep">
          Keep
        </button>
        <button class="btn" name="do" value="reject">
          Remove
        </button>
      </div>
    )}
    <div class="inline">
      <span class="meta">Move to</span>
      <button class="btn" name="do" value="later">
        Read later
      </button>
      <button class="btn" name="do" value="saved">
        Bookmarks
      </button>
      <button class="btn" name="do" value="archived">
        Archive
      </button>
      <button class="btn danger" name="do" value="delete">
        Delete
      </button>
    </div>
  </form>
);

const Pager: FC<{ newer?: string; older?: string }> = ({ newer, older }) =>
  newer || older ? (
    <div class="pager">
      {newer ? (
        <a class="btn" href={newer}>
          Newer
        </a>
      ) : (
        <span></span>
      )}
      {older && (
        <a class="btn" href={older}>
          Older
        </a>
      )}
    </div>
  ) : null;

export const List: FC<{
  nav: Nav;
  active: string;
  heading: string;
  items: Bookmark[];
  notes: Note[];
  q?: string;
  tag?: string;
  first: number; // position of the first row in the whole list
  total: number;
  marks: boolean;
  notice?: string;
  newer?: string;
  older?: string;
  toggle: string;
  select?: Selecting;
}> = (p) => (
  <Layout nav={p.nav} active={p.active} q={p.q} tag={p.tag}>
    <section>
      <div class="head">
        <h2>{p.heading}</h2>
        <span class="n">
          {p.total > p.items.length ? `${p.first}–${p.first + p.items.length - 1} of ${p.total}` : p.total}
          {p.items.length > 0 && " · "}
          {p.items.length > 0 && <a href={p.toggle}>{p.select ? "Done" : "Select"}</a>}
        </span>
      </div>
      <div class="strip">
        <TagCloud tags={p.nav.tags} current={p.tag} />
      </div>
      {p.tag && !p.q && !p.select && p.items.length > 0 && (
        <details class="whole">
          <summary>Rename this tag</summary>
          <form class="inline" method="post" action="/tag">
            <input type="hidden" name="tag" value={p.tag} />
            <input type="text" name="to" placeholder="new name" aria-label="New name" autocapitalize="off" required />
            <button class="btn">Rename</button>
          </form>
        </details>
      )}
      {p.select && <Bulk s={p.select} shown={p.items.length} total={p.total} tag={p.tag} auto={p.items.some((b) => b.auto.length > 0)} />}
      {p.notice && (
        <p class="notice" role="status">
          {p.notice}
        </p>
      )}
      <Pager newer={p.newer} older={p.older} />
      <Rows items={p.items} empty="Nothing here." select={!!p.select} marks={p.marks} hide={p.tag} />
      <Pager newer={p.newer} older={p.older} />
    </section>
    {p.notes.length > 0 && (
      <section>
        <div class="head">
          <h2>Done notes</h2>
          <span class="n">{p.notes.length}</span>
        </div>
        <Notes items={p.notes} />
      </section>
    )}
  </Layout>
);

// Asked before a bulk delete goes through. Carries the ids, so what is deleted is what was counted.
export const ConfirmDelete: FC<{ nav: Nav; ids: number[]; ret: string }> = ({ nav, ids, ret }) => (
  <Layout nav={nav}>
    <section>
      <div class="head">
        <h2>
          Delete {ids.length} {ids.length === 1 ? "bookmark" : "bookmarks"}?
        </h2>
      </div>
      <p>They are removed for good, not archived.</p>
      <form class="inline" method="post" action="/bulk">
        <input type="hidden" name="ids" value={ids.join(",")} />
        <input type="hidden" name="ret" value={ret} />
        <input type="hidden" name="do" value="delete" />
        <button class="btn danger" name="confirm" value="1">
          Delete
        </button>
        <a class="btn" href={ret}>
          Cancel
        </a>
      </form>
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

export const Settings: FC<{ nav: Nav; origin: string; tagger: boolean }> = ({ nav, origin, tagger }) => {
  const bookmarklet = `javascript:(()=>{window.open('${origin}/add?popup=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'marks','width=480,height=640')})()`;
  return (
    <Layout nav={nav} active="settings">
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
        <p>Choose the bookmarks HTML file your browser exports. It is read here in the browser. Folders become tags, and bookmarks you already have only gain tags.</p>
        <form id="import" class="inline">
          <input type="file" name="file" accept=".html,.htm,text/html" required aria-label="Bookmarks file" />
          <button class="btn primary">Import</button>
          {tagger && (
            <label>
              <input type="checkbox" name="tag" checked /> Suggest tags for bookmarks left without any
            </label>
          )}
        </form>
        <p id="import-status" role="status"></p>
        <script src="/import.js" defer></script>
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
        {tagger && (
          <>
            <p>Bookmarks without any tag, from an import for example, can be tagged in one go. Their addresses and titles are sent to the Claude API.</p>
            <form id="tag-untagged" class="inline">
              <button class="btn">Tag untagged bookmarks</button>
            </form>
            <p id="tag-status" role="status"></p>
          </>
        )}
      </section>
    </Layout>
  );
};
