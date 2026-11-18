// All D1 queries.

import { cleanUrl, normalizeUrl } from "./url";

export type Status = "saved" | "later" | "archived";

export interface Bookmark {
  id: number;
  url: string;
  url_norm: string;
  title: string;
  note: string;
  status: Status;
  pinned_pos: number | null;
  created_at: number;
  updated_at: number;
  icon: number | null; // when the site icon was fetched, null without one
  tags: string[];
}

type Row = Omit<Bookmark, "tags"> & { tags: string | null };

const SELECT = `SELECT b.*,
  (SELECT group_concat(tag, ' ') FROM bookmark_tags t WHERE t.bookmark_id = b.id) AS tags,
  (SELECT fetched_at FROM icons i WHERE i.bookmark_id = b.id) AS icon
  FROM bookmarks b`;

const toBookmark = (r: Row): Bookmark => ({ ...r, tags: r.tags ? r.tags.split(" ").sort() : [] });

const now = () => Math.floor(Date.now() / 1000);

export interface Filter {
  status?: Status;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function list(db: D1Database, f: Filter = {}): Promise<Bookmark[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status) {
    where.push("b.status = ?");
    args.push(f.status);
  } else {
    where.push("b.status != 'archived'");
  }
  if (f.tag) {
    where.push("EXISTS (SELECT 1 FROM bookmark_tags t WHERE t.bookmark_id = b.id AND t.tag = ?)");
    args.push(f.tag);
  }
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    where.push(
      "(b.title LIKE ? OR b.url LIKE ? OR b.note LIKE ? OR EXISTS (SELECT 1 FROM bookmark_tags t WHERE t.bookmark_id = b.id AND t.tag LIKE ?))",
    );
    args.push(like, like, like, like);
  }
  const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`;
  const { results } = await db.prepare(sql).bind(...args, f.limit ?? 200, f.offset ?? 0).all<Row>();
  return results.map(toBookmark);
}

export async function pinned(db: D1Database): Promise<Bookmark[]> {
  const { results } = await db.prepare(`${SELECT} WHERE b.pinned_pos IS NOT NULL ORDER BY b.pinned_pos, b.id`).all<Row>();
  return results.map(toBookmark);
}

export async function byId(db: D1Database, id: number): Promise<Bookmark | null> {
  const row = await db.prepare(`${SELECT} WHERE b.id = ?`).bind(id).first<Row>();
  return row ? toBookmark(row) : null;
}

export async function byUrl(db: D1Database, url: URL): Promise<Bookmark | null> {
  const row = await db.prepare(`${SELECT} WHERE b.url_norm = ?`).bind(normalizeUrl(url)).first<Row>();
  return row ? toBookmark(row) : null;
}

export async function counts(db: D1Database): Promise<Record<Status, number>> {
  // Done notes count as archived, next to the archived bookmarks.
  const { results } = await db
    .prepare(
      `SELECT status, count(*) AS n FROM bookmarks GROUP BY status
       UNION ALL SELECT 'archived', count(*) FROM notes WHERE done_at IS NOT NULL`,
    )
    .all<{ status: Status; n: number }>();
  const out = { saved: 0, later: 0, archived: 0 };
  for (const r of results) out[r.status] += r.n;
  return out;
}

export async function tagCounts(db: D1Database): Promise<{ tag: string; n: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT t.tag, count(*) AS n FROM bookmark_tags t JOIN bookmarks b ON b.id = t.bookmark_id
       WHERE b.status != 'archived' GROUP BY t.tag ORDER BY n DESC, t.tag`,
    )
    .all<{ tag: string; n: number }>();
  return results;
}

export interface SaveInput {
  id?: number; // set when editing an existing bookmark
  url: URL;
  strip: boolean;
  title?: string;
  note?: string;
  status?: Status;
  pin?: boolean;
  tags: string[];
  replaceTags: boolean; // false merges into the tags already there
  auto?: boolean;
}

// Inserts, or updates the bookmark that already has this URL. Returns its id,
// or null when an edit would turn one bookmark into a copy of another.
export async function save(db: D1Database, s: SaveInput): Promise<number | null> {
  const url = cleanUrl(s.url, s.strip);
  const norm = normalizeUrl(s.url);
  const ts = now();
  let id: number;

  if (s.id) {
    const clash = await db.prepare("SELECT id FROM bookmarks WHERE url_norm = ? AND id != ?").bind(norm, s.id).first();
    if (clash) return null;
    await db
      .prepare("UPDATE bookmarks SET url = ?, url_norm = ?, title = ?, note = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(url, norm, s.title ?? "", s.note ?? "", s.status ?? "saved", ts, s.id)
      .run();
    id = s.id;
  } else {
    // Empty title and note keep what is stored. A missing status keeps the stored
    // one too, except that saving an archived bookmark again brings it back.
    const row = await db
      .prepare(
        `INSERT INTO bookmarks (url, url_norm, title, note, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, coalesce(?5, 'saved'), ?6, ?6)
         ON CONFLICT(url_norm) DO UPDATE SET
           title = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END,
           note = CASE WHEN excluded.note != '' THEN excluded.note ELSE note END,
           status = coalesce(?5, CASE WHEN status = 'archived' THEN 'saved' ELSE status END),
           updated_at = ?6
         RETURNING id`,
      )
      .bind(url, norm, s.title ?? "", s.note ?? "", s.status ?? null, ts)
      .first<{ id: number }>();
    id = row!.id;
  }

  const stmts: D1PreparedStatement[] = [];
  if (s.replaceTags) stmts.push(db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(id));
  if (s.tags.length) stmts.push(addTagsStmt(db, id, s.tags, s.auto ?? false));
  if (s.pin === true) {
    stmts.push(
      db
        .prepare("UPDATE bookmarks SET pinned_pos = (SELECT coalesce(max(pinned_pos), 0) + 1 FROM bookmarks) WHERE id = ? AND pinned_pos IS NULL")
        .bind(id),
    );
  } else if (s.pin === false) {
    stmts.push(db.prepare("UPDATE bookmarks SET pinned_pos = NULL WHERE id = ?").bind(id));
  }
  if (stmts.length) await db.batch(stmts);
  return id;
}

function addTagsStmt(db: D1Database, id: number, tags: string[], auto: boolean): D1PreparedStatement {
  return db
    .prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag, auto) SELECT ?1, value, ?3 FROM json_each(?2)")
    .bind(id, JSON.stringify(tags), auto ? 1 : 0);
}

export async function addTags(db: D1Database, id: number, tags: string[], auto: boolean): Promise<void> {
  if (tags.length) await addTagsStmt(db, id, tags, auto).run();
}

export async function setStatus(db: D1Database, id: number, status: Status): Promise<void> {
  await db.prepare("UPDATE bookmarks SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
}

export async function unpin(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE bookmarks SET pinned_pos = NULL WHERE id = ?").bind(id).run();
}

export async function remove(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(id),
    db.prepare("DELETE FROM icons WHERE bookmark_id = ?").bind(id),
    db.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id),
  ]);
}

// ids in their new order; anything pinned but not listed keeps its place after them.
export async function reorder(db: D1Database, ids: number[]): Promise<void> {
  await db
    .prepare(
      `UPDATE bookmarks SET pinned_pos = (SELECT key + 1 FROM json_each(?1) WHERE value = bookmarks.id)
       WHERE pinned_pos IS NOT NULL AND id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(ids))
    .run();
}

export async function setIcon(db: D1Database, id: number, type: string, data: ArrayBuffer): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO icons (bookmark_id, type, data, fetched_at) VALUES (?, ?, ?, ?)")
    .bind(id, type, data, now())
    .run();
}

export async function getIcon(db: D1Database, id: number): Promise<{ type: string; data: Uint8Array } | null> {
  const row = await db.prepare("SELECT type, data FROM icons WHERE bookmark_id = ?").bind(id).first<{ type: string; data: ArrayLike<number> }>();
  return row ? { type: row.type, data: new Uint8Array(row.data) } : null;
}

export interface Note {
  id: number;
  text: string;
  created_at: number;
  done_at: number | null;
}

export async function notes(db: D1Database, done: boolean): Promise<Note[]> {
  const sql = done
    ? "SELECT * FROM notes WHERE done_at IS NOT NULL ORDER BY done_at DESC LIMIT 200"
    : "SELECT * FROM notes WHERE done_at IS NULL ORDER BY created_at DESC, id DESC";
  return (await db.prepare(sql).all<Note>()).results;
}

export async function addNote(db: D1Database, text: string): Promise<number> {
  const row = await db.prepare("INSERT INTO notes (text, created_at) VALUES (?, ?) RETURNING id").bind(text, now()).first<{ id: number }>();
  return row!.id;
}

export async function setNoteDone(db: D1Database, id: number, done: boolean): Promise<void> {
  await db.prepare("UPDATE notes SET done_at = ? WHERE id = ?").bind(done ? now() : null, id).run();
}

export async function removeNote(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
}

export interface ImportItem {
  url: string;
  title: string;
  tags: string[];
  created: number; // unix seconds, 0 when unknown
}

// One batch of an import, two statements however many bookmarks it holds:
// existing ones keep their fields and gain the tags.
export async function importAll(db: D1Database, items: ImportItem[]): Promise<number> {
  const byNorm = new Map<string, { u: string; n: string; t: string; c: number; g: string[] }>();
  for (const it of items) {
    const u = URL.canParse(it.url) ? new URL(it.url) : null;
    if (!u || !/^https?:$/.test(u.protocol)) continue;
    const n = normalizeUrl(u);
    const dupe = byNorm.get(n);
    if (dupe) dupe.g = [...new Set([...dupe.g, ...it.tags])];
    else byNorm.set(n, { u: cleanUrl(u, true), n, t: it.title, c: it.created || now(), g: it.tags });
  }
  if (!byNorm.size) return 0;
  const json = JSON.stringify([...byNorm.values()]);
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO bookmarks (url, url_norm, title, created_at, updated_at)
         SELECT json_extract(value, '$.u'), json_extract(value, '$.n'), json_extract(value, '$.t'),
                json_extract(value, '$.c'), json_extract(value, '$.c')
         FROM json_each(?1) WHERE true
         ON CONFLICT(url_norm) DO NOTHING`,
      )
      .bind(json),
    db
      .prepare(
        `INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag, auto)
         SELECT b.id, g.value, 0
         FROM json_each(?1) j
         JOIN bookmarks b ON b.url_norm = json_extract(j.value, '$.n'),
              json_each(json_extract(j.value, '$.g')) g`,
      )
      .bind(json),
  ]);
  return ins.meta.changes ?? 0;
}

export async function exportAll(db: D1Database): Promise<Bookmark[]> {
  const { results } = await db.prepare(`${SELECT} ORDER BY b.created_at, b.id`).all<Row>();
  return results.map(toBookmark);
}
