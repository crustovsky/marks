// URL cleaning and the normalized form used to spot duplicates.

const TRACKING =
  /^(utm_\w+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|twclid|ttclid|mc_cid|mc_eid|igshid|si|ref|ref_src|ref_url|_hsenc|_hsmi|vero_id|s_cid)$/i;

const URL_LIKE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/i;

export function looksLikeUrl(text: string): boolean {
  return URL_LIKE.test(text.trim());
}

// Accepts "example.com/x" as well as full URLs. Null for anything that is not http(s).
export function parseUrl(input: string): URL | null {
  const text = input.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

export function stripTracking(u: URL): URL {
  const out = new URL(u.href);
  for (const key of [...out.searchParams.keys()]) {
    if (TRACKING.test(key)) out.searchParams.delete(key);
  }
  return out;
}

// What gets stored and opened: the URL as given, optionally without tracking parameters.
export function cleanUrl(u: URL, strip: boolean): string {
  return (strip ? stripTracking(u) : u).href;
}

// Two URLs with the same normalized form are the same bookmark: no scheme, no
// "www.", no tracking parameters, no trailing slash, no fragment (unless the
// fragment is a route, "#/..." or "#!...").
export function normalizeUrl(u: URL): string {
  const s = stripTracking(u);
  const host = s.host.toLowerCase().replace(/^www\./, "");
  const path = s.pathname.replace(/\/+$/, "");
  const hash = /^#[/!]/.test(s.hash) ? s.hash : "";
  return host + path + s.search + hash;
}

// Where a form may send the browser afterwards: a path on this site, or null.
// "//host" and "/\host" lead to another site, and browsers drop tabs and line
// breaks from an address, which could turn a harmless looking path into one.
export function localPath(to: string): string | null {
  return /^\/(?![/\\])[^\\\x00-\x1f]*$/.test(to) ? to : null;
}

// Top level folders of a bookmarks export that say nothing about the bookmark.
const PLAIN_FOLDER = /^(bookmarks?( bar| menu| toolbar)?|favou?rites( bar)?|other bookmarks|mobile bookmarks|imported|speed dial|unsorted bookmarks|toolbar|menu)$/i;

// The folders an imported bookmark sat in become its tags: ["Bookmarks bar", "Dev Tools"] -> ["dev-tools"]
export function folderTags(folders: string[]): string[] {
  return cleanTags(folders.map((f) => f.trim()).filter((f) => f && !PLAIN_FOLDER.test(f)).map((f) => f.replace(/\s+/g, "-")));
}

// "Dev, #Linux  energy" -> ["dev", "linux", "energy"]
export function cleanTags(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(/[\s,]+/);
  const tags = parts
    .map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 32))
    .filter(Boolean);
  return [...new Set(tags)];
}
