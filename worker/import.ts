// Parses the bookmarks HTML file every browser exports (the Netscape format).
// Folder names become tags.

import type { ImportItem } from "./db";
import { decode } from "./page";
import { cleanTags } from "./url";

// Top level folders that say nothing about the bookmark.
const SKIP = /^(bookmarks?( bar| menu| toolbar)?|favou?rites( bar)?|other bookmarks|mobile bookmarks|imported|speed dial|unsorted bookmarks|toolbar|menu)$/i;

const TOKEN = /<h3[^>]*>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>|<dl>|<\/dl>/gi;

export function parseBookmarks(html: string): ImportItem[] {
  const items: ImportItem[] = [];
  const folders: string[] = [];
  let pending = "";
  for (const m of html.matchAll(TOKEN)) {
    const token = m[0].toLowerCase();
    if (token === "<dl>") {
      folders.push(pending);
      pending = "";
    } else if (token === "</dl>") {
      folders.pop();
    } else if (m[1] !== undefined) {
      pending = text(m[1]);
    } else {
      const href = m[2].match(/href="([^"]*)"/i)?.[1];
      if (!href || !/^https?:/i.test(href)) continue;
      const names = folders.filter((f) => f && !SKIP.test(f)).map((f) => f.replace(/\s+/g, "-"));
      items.push({
        url: decode(href),
        title: text(m[3]),
        tags: cleanTags(names),
        created: Number(m[2].match(/add_date="(\d+)"/i)?.[1] ?? 0),
      });
    }
  }
  return items;
}

const text = (html: string) => decode(html.replace(/<[^>]*>/g, "")).trim();
