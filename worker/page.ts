// Reads a page's title and description when a bookmark is saved without them.

export interface PageInfo {
  title: string;
  description: string;
}

export async function fetchPage(url: string): Promise<PageInfo> {
  const info: PageInfo = { title: "", description: "" };
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; marks)", accept: "text/html" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return info;
    let og = "";
    const rewritten = new HTMLRewriter()
      .on("title", { text: (t) => void (info.title += t.text) })
      .on('meta[property="og:title"]', { element: (e) => void (og = e.getAttribute("content") ?? "") })
      .on('meta[name="description"]', { element: (e) => void (info.description = e.getAttribute("content") ?? "") })
      .transform(res);
    await rewritten.arrayBuffer();
    info.title = decode(info.title || og).replace(/\s+/g, " ").trim().slice(0, 300);
    info.description = decode(info.description).trim().slice(0, 500);
  } catch {
    // Unreachable or slow pages are saved with the address as their title.
  }
  return info;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}
