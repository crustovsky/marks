// Created by the Worker itself on first use, so a one-click deploy needs no migration step.
// Every statement is idempotent.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    url_norm TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'saved',
    pinned_pos INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  // auto = 1 marks tags added by the tagger without anyone confirming them.
  `CREATE TABLE IF NOT EXISTS bookmark_tags (
    bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    auto INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bookmark_id, tag)
  )`,
  // Site icons for the quick access tiles, fetched when a bookmark is pinned.
  `CREATE TABLE IF NOT EXISTS icons (
    bookmark_id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    data BLOB NOT NULL,
    fetched_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS bookmarks_status ON bookmarks (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS bookmark_tags_tag ON bookmark_tags (tag)`,
];

let ready = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  ready = true;
}
