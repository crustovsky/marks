// Reads a page's title, description and site icon.

export interface PageInfo {
  title: string;
  description: string;
  icons: string[]; // candidate icon addresses, best first
}

export async function fetchPage(url: string): Promise<PageInfo> {
  const info: PageInfo = { title: "", description: "", icons: [] };
  const touch: string[] = [];
  const plain: string[] = [];
  const href = (list: string[]) => ({
    element: (e: Element) => {
      const h = e.getAttribute("href");
      if (h && URL.canParse(h, url)) list.push(new URL(h, url).href);
    },
  });
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
      .on('link[rel="apple-touch-icon"]', href(touch))
      .on('link[rel~="icon"]', href(plain))
      .transform(res);
    await rewritten.arrayBuffer();
    info.title = decode(info.title || og).replace(/\s+/g, " ").trim().slice(0, 300);
    info.description = decode(info.description).trim().slice(0, 500);
  } catch {
    // Unreachable or slow pages are saved with the address as their title.
  }
  // Touch icons are the larger ones; /favicon.ico is the fallback every site may have.
  info.icons = [...touch, ...plain, new URL("/favicon.ico", url).href];
  return info;
}

const MAX_ICON = 200 * 1024;

export async function fetchIcon(url: string): Promise<{ type: string; data: ArrayBuffer } | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; marks)" }, signal: AbortSignal.timeout(5000) });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!res.ok || !type.startsWith("image/")) return null;
    const data = await res.arrayBuffer();
    return data.byteLength > 0 && data.byteLength <= MAX_ICON ? { type, data } : null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}
