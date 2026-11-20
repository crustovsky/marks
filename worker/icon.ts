// Finds a site's icon: the page's own links and web manifest, /favicon.ico, the
// same again on the site's root domain and, when switched on, an icon service.

export interface Icon {
  type: string;
  data: ArrayBuffer;
}

export const MAX_ICON = 200 * 1024;
const TIMEOUT = 4000; // per request
const MAX_REQUESTS = 14; // per search: pages, manifests and icons together
const PER_PAGE = 4; // icons tried from one page before moving on

// Many sites turn away anything that does not look like a browser.
const AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HTML = "text/html,application/xhtml+xml,*/*;q=0.8";
const IMAGE = "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8";

// Hosts a Worker can never reach: tailnets, local names and private addresses.
// Their icon has to be given by hand on the edit form.
export function unreachable(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv6: loopback, unique local and link local.
  if (h.includes(":")) return /^(::1?$|f[cd]|fe[89ab])/.test(h);
  const ip = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    // The last range is the shared one that Tailscale hands out.
    return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b < 128);
  }
  return !h.includes(".") || /\.(ts\.net|local|localhost|internal|lan|home|home\.arpa)$/.test(h);
}

// The registrable domain, near enough: the last two labels, or three under a
// country code with a generic second level (example.co.uk). The public suffix
// list would be exact and is far too large to carry for this.
export function rootDomain(hostname: string): string {
  const labels = hostname.split(".");
  if (labels.length < 3 || /^[\d.]+$/.test(hostname) || hostname.includes(":")) return hostname;
  const [second, top] = labels.slice(-2);
  const keep = top.length === 2 && /^(co|com|org|net|gov|edu|ac)$/.test(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

// The image type the first bytes say it is. Servers often send an .ico as
// application/octet-stream, and a login page as whatever was asked for.
// An SVG is text, so it also has to be declared as one.
function sniff(b: Uint8Array, declared: string): string | null {
  const at = (from: number, ...bytes: number[]) => bytes.every((v, i) => b[from + i] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0, 0, 1, 0)) return "image/x-icon";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (declared === "image/svg+xml" && /<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 2048)))) return declared;
  return null;
}

// An icon when the bytes are a PNG, ICO, JPEG, GIF, WebP or SVG of a sensible
// size, null otherwise. `declared` is the type the server or the browser gave.
export function asIcon(data: ArrayBuffer, declared: string): Icon | null {
  if (!data.byteLength || data.byteLength > MAX_ICON) return null;
  const type = sniff(new Uint8Array(data), declared.split(";")[0].trim().toLowerCase());
  return type ? { type, data } : null;
}

export interface Link {
  rel: string; // as in <link rel>, or "manifest" for an icon listed in a web manifest
  href: string; // absolute
  sizes?: string | null;
  type?: string | null;
}

// Icon addresses, best first: the largest square raster image wins. An SVG is
// sharp but not raster, so it beats a small favicon and loses to a touch icon.
// A mask icon is a one colour silhouette and comes last.
export function rank(links: Link[]): string[] {
  const scored = links.flatMap((l) => {
    if (!/^https?:/.test(l.href)) return [];
    const rels = l.rel.toLowerCase().split(/\s+/);
    const touch = rels.some((r) => r.startsWith("apple-touch-icon"));
    const squares = [...(l.sizes ?? "").matchAll(/(\d+)x(\d+)/gi)].filter((m) => m[1] === m[2]).map((m) => Number(m[1]));
    let score: number;
    if (rels.includes("mask-icon")) score = 1;
    else if (!touch && !rels.includes("icon") && !rels.includes("manifest")) return [];
    else if (/svg/i.test(l.type ?? "") || /\.svg($|\?)/i.test(l.href)) score = 48;
    else if (squares.length) score = Math.max(...squares);
    else score = touch ? 180 : 32;
    return [{ href: l.href, score }];
  });
  return [...new Set(scored.sort((a, b) => b.score - a.score).map((s) => s.href))];
}

type Get = (url: string, accept: string) => Promise<Response | null>;

// One search shares one budget of requests and never asks for an address twice.
function budget(): Get {
  let left = MAX_REQUESTS;
  const tried = new Set<string>();
  return async (url, accept) => {
    if (left <= 0 || tried.has(url) || !URL.canParse(url) || unreachable(new URL(url).hostname)) return null;
    tried.add(url);
    left--;
    try {
      // Redirects are followed, which is fetch's default.
      const res = await fetch(url, { headers: { "user-agent": AGENT, accept }, signal: AbortSignal.timeout(TIMEOUT) });
      if (res.status === 200) return res;
      await res.body?.cancel();
    } catch {
      // Unreachable or slow: the next candidate gets its turn.
    }
    return null;
  };
}

// Reads a body up to the size limit and gives up on anything longer. The
// length a server declares cannot be relied on, and it may declare none, so
// the bytes are counted as they arrive and the rest is never held in memory.
async function read(body: ReadableStream<Uint8Array>): Promise<ArrayBuffer | null> {
  const reader = body.getReader();
  const out = new Uint8Array(MAX_ICON);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.slice(0, size).buffer;
    if (size + value.byteLength > MAX_ICON) {
      await reader.cancel();
      return null;
    }
    out.set(value, size);
    size += value.byteLength;
  }
}

async function image(res: Response | null): Promise<Icon | null> {
  if (!res?.body) return null;
  try {
    const data = await read(res.body);
    return data && asIcon(data, res.headers.get("content-type") ?? "");
  } catch {
    return null;
  }
}

async function manifestIcons(get: Get, url: string): Promise<Link[]> {
  const res = await get(url, "application/manifest+json,application/json,*/*;q=0.8");
  if (!res) return [];
  try {
    const { icons } = await res.json<{ icons?: { src?: unknown; sizes?: unknown; type?: unknown; purpose?: unknown }[] }>();
    if (!Array.isArray(icons)) return [];
    const base = res.url || url;
    return icons.flatMap((i) =>
      typeof i.src === "string" && URL.canParse(i.src, base)
        ? [{ rel: i.purpose === "monochrome" ? "mask-icon" : "manifest", href: new URL(i.src, base).href, sizes: String(i.sizes ?? ""), type: String(i.type ?? "") }]
        : [],
    );
  } catch {
    return [];
  }
}

// The icons one page names, then /favicon.ico where the page ended up.
async function fromSite(get: Get, url: string): Promise<Icon | null> {
  let base = url;
  const links: Link[] = [];
  const res = await get(url, HTML);
  if (res) {
    // Relative addresses belong to the page the redirects led to.
    base = res.url || url;
    let manifest = "";
    try {
      if (!(res.headers.get("content-type") ?? "").includes("html")) throw new Error("not a page");
      const page = new HTMLRewriter()
        .on("link[rel][href]", {
          element: (e) => {
            const rel = e.getAttribute("rel")!;
            const href = e.getAttribute("href")!;
            // An empty href would point back at the page itself.
            if (!href.trim() || !URL.canParse(href, base)) return;
            if (/(^|\s)manifest(\s|$)/i.test(rel)) manifest = new URL(href, base).href;
            else links.push({ rel, href: new URL(href, base).href, sizes: e.getAttribute("sizes"), type: e.getAttribute("type") });
          },
        })
        .transform(res);
      await page.arrayBuffer();
    } catch {
      await res.body?.cancel().catch(() => {});
    }
    if (manifest) links.push(...(await manifestIcons(get, manifest)));
  }
  // /favicon.ico is ranked with the rest: below anything the page names in
  // colour, above a mask icon.
  const favicon: Link = { rel: "icon", href: new URL("/favicon.ico", base).href, sizes: "16x16" };
  for (const href of rank([...links, favicon]).slice(0, PER_PAGE)) {
    const icon = await image(await get(href, IMAGE));
    if (icon) return icon;
  }
  return null;
}

// `service` is the ICON_SERVICE setting: an address with {domain} in it, or
// empty. Using it tells a third party which sites are bookmarked, so it is off
// unless set and only asked when the site itself gave nothing.
export async function findIcon(url: string, service: string): Promise<Icon | null> {
  const page = new URL(url);
  if (unreachable(page.hostname)) return null;
  const get = budget();
  const root = rootDomain(page.hostname);
  // The second round is the home page of the root domain: accounts.example.com
  // may show a login wall where example.com shows its icons.
  for (const site of [page.href, `https://${root}/`]) {
    const icon = await fromSite(get, site);
    if (icon) return icon;
  }
  if (!service) return null;
  for (const domain of [page.hostname, root]) {
    const icon = await image(await get(service.replace("{domain}", domain), IMAGE));
    if (icon) return icon;
  }
  return null;
}

// An icon address given by hand is fetched as it is, with no searching.
export async function fetchIcon(url: string): Promise<Icon | null> {
  return image(await budget()(url, IMAGE));
}
