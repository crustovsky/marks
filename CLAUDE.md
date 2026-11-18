# marks

Self-hosted bookmark manager: one Cloudflare Worker (Hono, server-rendered JSX), D1, behind Cloudflare Access. README.md describes what it does and how it is deployed; read it first.

## Commands

```sh
npm run dev      # wrangler dev on :8787, local D1, simulated Access user
npm test         # vitest
npm run check    # wrangler types, then tsc
npm run deploy   # uses wrangler.local.jsonc when it exists
```

Run `npm test` and `npm run check` before calling a change done. For anything that touches a route or a page, also try it against `npm run dev`.

## Principles

- Simple and readable beats clever. Less code is the goal; add a dependency or an abstraction only when it removes more than it adds.
- The pages must work without JavaScript, except drag to reorder, the tag picker and tag suggestions. No client framework, no build step.
- Keep the page weight small. This is a browser start page.

## Rules

- **Private by default.** The first middleware in `worker/index.tsx` rejects every request that Cloudflare Access did not authenticate, unless `ALLOW_PUBLIC` is `true`. Nothing may be served before it, and no route may bypass it.
- **No Workers static assets.** Asset requests would skip the Worker and with it the Access check. The stylesheet and scripts are imported as text (see `rules` in `wrangler.jsonc`) and served by routes.
- **This repository is meant to be public.** Never commit hostnames, account or database ids, email addresses, API keys, real bookmarks or anything else personal. Personal settings go in `wrangler.local.jsonc` and `.dev.vars`, both ignored by git. Examples and tests use `example.com`.
- **Schema** lives in `worker/schema.ts` and is created by the Worker on first use. Every statement must be idempotent, so a one-click deploy needs no migration. Changing a table means adding a statement that upgrades an existing database.
- **All SQL is in `worker/db.ts`.** Routes call its functions. Keep the number of queries per request low (the free plan caps them); bulk work goes through `json_each` in one statement, as `importAll` and `reorder` do.
- **Duplicates** are decided by `normalizeUrl` in `worker/url.ts`. A change there changes which bookmarks count as the same, and existing `url_norm` values would need recomputing.
- **Escaping**: pages are JSX, which escapes for you. Do not build HTML from strings and do not use `dangerouslySetInnerHTML`.
- **State changes are POST** forms or JSON calls. The `csrf()` middleware rejects form posts from other origins.
- **The tagger is optional.** Every path must work with `ANTHROPIC_API_KEY` unset, and a failed API call must never fail a save.

## Style

- TypeScript, strict. Two space indent, double quotes, semicolons.
- Comments say why, not what. One short comment at the top of each file.
- Plain wording in the interface and the docs. No em dashes anywhere, in code, comments, docs or commit messages.
- New behaviour in `url.ts` or `import.ts` gets a test in `test/`.
