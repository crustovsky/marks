# marks

A small, self-hosted bookmark manager for people who move between browsers. One Cloudflare Worker keeps your bookmarks in a D1 database and serves a start page with a quick access grid, a tagged bookmark list and a read later queue. It replaces the bookmarks bar and speed dial of each browser with one page that is the same everywhere.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/crustovsky/marks)

- **Quick access**: a grid of pinned sites, reordered by drag and drop
- **Bookmarks**: tags instead of folders, search over title, address, note and tags
- **Read later**: a queue with Done and Keep, separate from the bookmarks you keep
- **Easy to add**: paste an address into the search box, use the bookmarklet, share to it on Android, or post to the API from an iOS Shortcut
- **No duplicates**: the same page saved twice is one bookmark, whatever the scheme, `www.`, trailing slash or tracking parameters
- **Strip tracking**: `utm_*`, `fbclid`, `gclid` and friends are removed on save, with a checkbox to keep the address as it is
- **Tag suggestions**, optional: with an Anthropic API key, new bookmarks get suggested tags that prefer the ones you already use
- **Import and export**: reads the bookmarks HTML file every browser exports, folders become tags; everything downloads as JSON
- Private by default: only visitors authenticated by [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) see anything
- Light and dark mode, works on a phone, installs as an app
- Under 20 KB of markup, styles and script per page; fits in the free tiers of Workers and D1

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

1. In the Cloudflare dashboard open **Workers & Pages** and select the Worker.
2. Open the **Access** tab and select **Protect this Worker behind Access**.
3. Choose **All traffic**. The default, Previews only, is not enough.
4. Choose who may sign in, for example your own email address.
5. Select **Apply Access**.

Set a long session duration on the Access application (a month, say), so each browser asks you to sign in rarely.

## Configuration

| Variable       | Default            | Meaning |
| -------------- | ------------------ | ------- |
| `ALLOW_PUBLIC` | `false`            | `true` serves visitors without Cloudflare Access. Anyone who finds the address can then read and change everything, so only use it behind some other gate. |
| `SITE_TITLE`   | `marks`            | Name in the top bar and on the home screen icon. |
| `TAG_MODEL`    | `claude-haiku-5-5` | Claude model used for tag suggestions. |

Secret, optional: `ANTHROPIC_API_KEY`. Set it with `npm run wrangler secret put ANTHROPIC_API_KEY` or in the dashboard to turn tag suggestions on. The Worker then sends the address, title and description of a new bookmark, plus your list of tag names, to the Anthropic API. Without the key nothing leaves the Worker except the request that reads a page's title.

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

Body fields: `url` (required), `title`, `tags` (list or space separated text), `later` (adds it to the read later queue), `strip` (`false` keeps tracking parameters). Without a title the Worker reads it from the page. Without tags, and with tag suggestions on, the suggested tags are applied and marked as automatic in the database.

## How it works

```
browser ──▶ Cloudflare Access ──▶ Worker (Hono, server-rendered pages + /api/*) ──▶ D1
                                     └─▶ Anthropic API (optional, tag suggestions)
```

**Pages** are rendered on the server with Hono's JSX. One stylesheet and one small script are bundled into the Worker as text and served by it. They are not served through Workers static assets, because Workers with static assets run behind a router that does not pass the Access identity to the Worker, which would defeat the private-by-default check. SortableJS is only loaded when you press Edit on the quick access grid.

**Duplicates** are found by a normalized form of the address (`url_norm`, unique): no scheme, no `www.`, no tracking parameters, no trailing slash, no fragment unless the fragment is a route. Saving an address that is already there updates that bookmark and merges the tags. The address that is stored and opened is the one you saved, without tracking parameters unless you untick the box.

**Data**: `bookmarks` (address, title, note, status `saved`, `later` or `archived`, position in the quick access grid) and `bookmark_tags`. Quick access and read later are fields, not tags.

**API** (same origin, behind Access): `POST /api/add`, `GET /api/suggest?url=&title=`, `POST /api/reorder` with `{ "ids": [...] }`, `GET /api/export`.

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
worker/import.ts   bookmarks HTML parser
worker/page.ts     reads a page's title
worker/tagger.ts   tag suggestions
worker/static/     stylesheet and browser script
test/              vitest
```

## License

MIT
