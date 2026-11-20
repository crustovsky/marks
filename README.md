# marks

A small, self-hosted bookmark manager for people who move between browsers. One Cloudflare Worker keeps your bookmarks in a D1 database and serves a start page with a quick access grid, a tagged bookmark list, a read later queue and quick notes. It replaces the bookmarks bar and speed dial of each browser with one page that is the same everywhere.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/crustovsky/marks)

- **Quick access**: a grid of pinned sites with their icons, reordered by dragging them with the mouse, or with a finger after pressing Edit
- **Bookmarks**: tags instead of folders, search over title, address, note and tags
- **Clean up in bulk**: Select on any list (a tag, a search, read later, everything) gives each row a tick box and one bar to add or remove tags, move to read later, bookmarks or the archive, or delete; it can act on the ticked rows or on everything the list matches, and says what it did
- **Untagged** and **Suggested tags** lists appear in the sidebar while they have something in them; tags from the tagger are outlined until you keep or remove them
- **Search inside a tag**: the search box on a tag's list searches that tag
- **Rename a tag** on its page; renaming into a tag that exists merges the two
- **Read later**: a queue with Done and Keep, separate from the bookmarks you keep
- **Quick notes**: a line of text jotted on the home page, marked done when dealt with, kept in the archive
- **Easy to add**: paste an address into the search box, use the bookmarklet, share to it on Android, or post to the API from an iOS Shortcut
- **No duplicates**: the same page saved twice is one bookmark, whatever the scheme, `www.`, trailing slash or tracking parameters
- **Strip tracking**: `utm_*`, `fbclid`, `gclid` and friends are removed on save, with a checkbox to keep the address as it is
- **Tag suggestions**, optional: with an Anthropic API key, new bookmarks get suggested tags that prefer the ones you already use, and bookmarks left without tags after an import can be tagged in one go
- **Import and export**: reads the bookmarks HTML file every browser exports, in the browser, folders become tags; bookmarks and notes download as JSON
- Private, always: only visitors authenticated by [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) see anything
- Light and dark mode, works on a phone, can be added to the home screen
- No framework and no build step: about 12 KB of styles and script; fits in the free tiers of Workers and D1

## Deploy

### With the Deploy to Cloudflare button

The button forks this repository into your GitHub or GitLab account, creates the D1 database and deploys the Worker to a `*.workers.dev` address. Every push to the new repository redeploys it.

After the deploy, [turn on Cloudflare Access](#turn-on-cloudflare-access). Until you do, the Worker only shows a "These bookmarks are private" page.

### Manually

```sh
git clone https://github.com/crustovsky/marks && cd marks
npm install
npx wrangler login
cp wrangler.jsonc wrangler.local.jsonc       # your copy, ignored by git: database id, domain, title
npx wrangler d1 create marks                 # paste the database_id into wrangler.local.jsonc
npm run deploy
```

`wrangler.local.jsonc` is where your own settings go. Every npm script uses it when it exists and falls back to the committed `wrangler.jsonc` otherwise. To serve the Worker on your own domain, add a `routes` entry with `custom_domain: true` there.

The tables are created by the Worker on its first request, so there is no migration step.

## Turn on Cloudflare Access

There is no setting that makes the bookmarks public. Everyone who gets in can add, edit and delete, so the Worker serves nothing at all until Access protects it.

1. In the Cloudflare dashboard open **Workers & Pages** and select the Worker.
2. Open the **Access** tab and select **Protect this Worker behind Access**.
3. Choose **All traffic**. The default, Previews only, is not enough.
4. Choose who may sign in, for example your own email address.
5. Select **Apply Access**.

Set a long session duration on the Access application (a month, say), so each browser asks you to sign in rarely.

## Configuration

| Variable       | Default            | Meaning |
| -------------- | ------------------ | ------- |
| `SITE_TITLE`   | `marks`            | Name in the top bar and on the home screen icon. |
| `TAG_MODEL`    | `claude-haiku-5-5` | Claude model used for tag suggestions. |
| `ICON_SERVICE` | empty              | A public icon service to ask when a site's own icon cannot be found: an address with `{domain}` in it, for example `https://icons.duckduckgo.com/ip3/{domain}.ico`. Off when empty, because the service learns the domains of your pinned bookmarks. |

Secret, optional: `ANTHROPIC_API_KEY`. Set it with `npm run wrangler secret put ANTHROPIC_API_KEY` or in the dashboard to turn tag suggestions on. The Worker then sends the address, title and description of a new bookmark, plus your list of tag names, to the Anthropic API. Tagging untagged bookmarks from the Settings page, or after an import with its box ticked, sends the address and title of each of them. Without the key nothing leaves the Worker except the requests that read a page's title and icon, which go to the bookmarked site and, only when `ICON_SERVICE` is set, to that service.

## Adding bookmarks

| From | How |
| --- | --- |
| The page itself | Paste an address into the search box and press Enter. Anything that is not an address is a search. |
| A desktop browser | Drag the bookmarklet from **Settings** to the bookmarks bar. It opens a small window with the page's address and title filled in. |
| Android | Install the page as an app (browser menu, **Add to Home screen**). It then appears in the share sheet. |
| iOS | A Shortcut that posts to `/api/add`, see below. |
| Another browser's bookmarks | **Settings → Import** with the exported HTML file. |

### iOS Shortcut and other scripts

Safari on iOS cannot share to a web app, so the share sheet needs a Shortcut. It has to get through Access without a browser session:

1. In Zero Trust create a [service token](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) and add a **Service Auth** policy for it to the Worker's Access application.
2. Make a Shortcut that accepts URLs from the share sheet and runs **Get Contents of URL**: method `POST`, URL `https://<your address>/api/add`, headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`, JSON body with `url` set to the Shortcut input.

The same call from a shell:

```sh
curl https://<your address>/api/add \
  -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" \
  -H "content-type: application/json" \
  -d '{"url": "https://example.com/article", "later": true}'
```

Body fields: `url` (required), `title`, `tags` (list or space separated text), `later` (adds it to the read later queue), `strip` (`false` keeps tracking parameters). Without a title the Worker reads it from the page. Without tags, and with tag suggestions on, the suggested tags are applied and marked as automatic; they show outlined and collect in the Suggested tags list until kept or removed.

## How it works

```
browser ──▶ Cloudflare Access ──▶ Worker (Hono, server-rendered pages + /api/*) ──▶ D1
                                     └─▶ Anthropic API (optional, tag suggestions)
```

**Pages** are rendered on the server with Hono's JSX. One stylesheet and two small scripts are bundled into the Worker as text and served by it. They are not served through Workers static assets, because Workers with static assets run behind a router that does not pass the Access identity to the Worker, which would defeat the Access check. SortableJS is only loaded when the mouse reaches the quick access grid or you press Edit on it.

**Duplicates** are found by a normalized form of the address (`url_norm`, unique): no scheme, no `www.`, no tracking parameters, no trailing slash, no fragment unless the fragment is a route. Adding an address that is already there opens that bookmark for editing; through the API it updates the bookmark and merges the tags. Either way an archived bookmark comes back. The address that is stored and opened is the one you saved, without tracking parameters unless you untick the box.

**Import**: the Settings page reads the exported file in the browser, which has a real HTML parser and no CPU limit, and sends the links to the Worker 500 at a time. The Worker decides what is a duplicate and which folders become tags, so a large file costs it no more per request than a small one. Running an import twice adds nothing twice. With tag suggestions on, the page then asks the Worker to tag the bookmarks that have no tags, 50 per request and one call to the model for each 50, until none are left.

**Lists** show 200 bookmarks per page, newest first. Edit on a row carries the list's address along (`/edit/7?back=...`), so Save, Cancel and Delete return to the same list and page. Only a path on the site itself is followed.

**Headers**: every page carries a content security policy that allows scripts, styles and images from the Worker itself only, forbids framing and limits forms to the same origin.

**Icons**: a pinned bookmark gets its site icon, kept in D1. The Worker reads the page the address leads to and takes the largest square icon it names (`rel="icon"`, `apple-touch-icon`, the web manifest), then `/favicon.ico`, then tries the same on the root domain (`example.com` for `accounts.example.com`), and last the icon service if `ICON_SERVICE` is set. Until the icon arrives, and for sites without one, the tile shows a coloured letter. In Edit mode each tile has a button that fetches the icon again.

Some sites answer a Worker with a login wall or not at all, and hosts on a tailnet, `.local` names and private addresses cannot be reached from a Worker, so they are never asked. For those the edit form has an **Icon** section: an address to fetch the icon from, or a file to upload (PNG, SVG, ICO or WebP, up to 200 KB). Clearing it goes back to finding the icon automatically.

**Data**: `bookmarks` (address, title, note, status `saved`, `later` or `archived`, position in the quick access grid), `bookmark_tags`, `icons`, `icon_sources` (icons set by hand) and `notes`. Quick access and read later are fields, not tags.

**API** (same origin, behind Access): `POST /api/add`, `GET /api/suggest?url=&title=`, `POST /api/reorder` with `{ "ids": [...] }`, `POST /api/note` with `{ "text": "..." }`, `POST /api/import` with `{ "items": [{ "url", "title", "folders", "created" }] }` (at most 500), `POST /api/tag` with `{ "after": id }` (tags the next 50 untagged bookmarks), `GET /api/export`.

## Develop

```sh
npm install
npm run dev        # http://localhost:8787 with a local, empty database
npm test
npm run check      # generates types, then type checks
```

The `access.dev` block in `wrangler.jsonc` simulates a signed-in Access user; remove it to see what an unauthenticated visitor gets. For tag suggestions locally, copy `.dev.vars.example` to `.dev.vars` and fill in the key.

```
worker/index.tsx   routes, Access gate
worker/views.tsx   pages
worker/db.ts       every D1 query
worker/schema.ts   tables, created on first use
worker/url.ts      address cleaning and the duplicate key
worker/page.ts     reads a page's title
worker/icon.ts     finds a site's icon
worker/tagger.ts   tag suggestions
worker/static/     stylesheet, page script, bookmarks import
test/              vitest
```

## License

MIT
