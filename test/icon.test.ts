import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_ICON, asIcon, fetchIcon, findIcon, rank, rootDomain, unreachable } from "../worker/icon";

const bytes = (...b: number[]) => new Uint8Array(b).buffer;
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const ICO = bytes(0, 0, 1, 0, 1, 0, 16, 16);
const text = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("unreachable", () => {
  it("knows tailnets, local names and private addresses", () => {
    for (const h of ["dashboard.tail1234.ts.net", "printer.local", "nas", "localhost", "10.0.0.5", "192.168.1.1", "172.20.0.1", "100.101.102.103", "127.0.0.1", "[::1]", "[fd7a:115c::1]"]) {
      expect(unreachable(h), h).toBe(true);
    }
  });
  it("lets public hosts through", () => {
    for (const h of ["example.com", "accounts.example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "[2606:4700::1111]"]) {
      expect(unreachable(h), h).toBe(false);
    }
  });
});

describe("rootDomain", () => {
  it("drops subdomains", () => {
    expect(rootDomain("accounts.example.com")).toBe("example.com");
    expect(rootDomain("a.b.example.com")).toBe("example.com");
    expect(rootDomain("example.com")).toBe("example.com");
  });
  it("keeps a generic second level under a country code", () => {
    expect(rootDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(rootDomain("www.example.com.pl")).toBe("example.com.pl");
  });
  it("leaves addresses alone", () => {
    expect(rootDomain("203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("asIcon", () => {
  it("goes by the bytes before the declared type", () => {
    expect(asIcon(ICO, "application/octet-stream")?.type).toBe("image/x-icon");
    expect(asIcon(PNG, "text/html")?.type).toBe("image/png");
  });
  it("takes an SVG that is declared as one", () => {
    expect(asIcon(text("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml")?.type).toBe("image/svg+xml");
    expect(asIcon(text("<html><svg/></html>"), "text/html")).toBeNull();
  });
  it("rejects pages whatever they claim to be, empty bodies and large files", () => {
    expect(asIcon(text("<!doctype html><title>Sign in</title>"), "text/html")).toBeNull();
    expect(asIcon(text("<!doctype html><title>Sign in</title>"), "image/png")).toBeNull();
    expect(asIcon(text("<!doctype html><title>Sign in</title>"), "image/svg+xml")).toBeNull();
    expect(asIcon(new ArrayBuffer(0), "image/png")).toBeNull();
    expect(asIcon(new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(MAX_ICON).fill(0)]).buffer, "image/png")).toBeNull();
  });
});

describe("rank", () => {
  const at = (path: string) => `https://example.com/${path}`;
  it("prefers the largest square raster icon, then SVG, then small ones, then a mask icon", () => {
    expect(
      rank([
        { rel: "mask-icon", href: at("mask.svg") },
        { rel: "shortcut icon", href: at("favicon.ico") },
        { rel: "icon", href: at("icon.svg"), type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: at("touch.png") },
        { rel: "manifest", href: at("512.png"), sizes: "512x512" },
        { rel: "icon", href: at("wide.png"), sizes: "300x100 16x16" },
      ]),
    ).toEqual(["512.png", "touch.png", "icon.svg", "favicon.ico", "wide.png", "mask.svg"].map(at));
  });
  it("ignores other links, data addresses and repeats", () => {
    expect(
      rank([
        { rel: "stylesheet", href: at("app.css") },
        { rel: "icon", href: "data:image/png;base64,AAAA" },
        { rel: "icon", href: at("a.png") },
        { rel: "ICON", href: at("a.png"), sizes: "64x64" },
      ]),
    ).toEqual([at("a.png")]);
  });
});

describe("fetching", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Answers each address from a table; anything else is a 404.
  const serve = (table: Record<string, () => Response>) => {
    const fetch = vi.fn(async (url: string) => table[url]?.() ?? new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };
  const ico = () => new Response(ICO, { headers: { "content-type": "image/vnd.microsoft.icon" } });

  it("makes no request for a host it cannot reach", async () => {
    const fetch = serve({});
    expect(await findIcon("http://dashboard.tail1234.ts.net/", "https://icons.example.com/{domain}.ico")).toBeNull();
    expect(await fetchIcon("http://192.168.1.10/icon.png")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the root domain when the site itself gives nothing", async () => {
    const fetch = serve({ "https://example.com/favicon.ico": ico });
    expect((await findIcon("https://accounts.example.com/login", ""))?.type).toBe("image/x-icon");
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      "https://accounts.example.com/login",
      "https://accounts.example.com/favicon.ico",
      "https://example.com/",
      "https://example.com/favicon.ico",
    ]);
  });

  it("does not take a login page for an icon", async () => {
    const page = () => new Response("<!doctype html><title>Sign in</title>", { headers: { "content-type": "text/html" } });
    serve({ "https://example.com/favicon.ico": page });
    expect(await findIcon("https://example.com/", "")).toBeNull();
  });

  it("asks the icon service last, and only when one is set", async () => {
    const fetch = serve({ "https://icons.example.net/example.com.ico": ico });
    expect(await findIcon("https://example.com/", "")).toBeNull();
    expect(fetch.mock.calls.some((c) => c[0].includes("icons.example.net"))).toBe(false);
    expect(await findIcon("https://example.com/", "https://icons.example.net/{domain}.ico")).not.toBeNull();
  });

  it("stops reading a body that outgrows the limit", async () => {
    let sent = 0;
    // A PNG that never ends and declares no length.
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(sent++ ? new Uint8Array(64 * 1024) : new Uint8Array(PNG));
      },
    });
    serve({ "https://cdn.example.com/big.png": () => new Response(endless, { headers: { "content-type": "image/png" } }) });
    expect(await fetchIcon("https://cdn.example.com/big.png")).toBeNull();
    expect(sent * 64 * 1024).toBeLessThan(2 * MAX_ICON);
  });

  it("fetches a given icon address as it is", async () => {
    const fetch = serve({ "https://cdn.example.com/logo.png": () => new Response(PNG, { headers: { "content-type": "application/octet-stream" } }) });
    expect((await fetchIcon("https://cdn.example.com/logo.png"))?.type).toBe("image/png");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
