import { describe, expect, it } from "vitest";
import { decode } from "../worker/page";
import { cleanTags, cleanUrl, folderTags, localPath, looksLikeUrl, normalizeUrl, parseUrl } from "../worker/url";

const norm = (s: string) => normalizeUrl(parseUrl(s)!);

describe("normalizeUrl", () => {
  it("treats scheme, www, trailing slash and tracking as noise", () => {
    expect(norm("http://www.Example.com/a/?utm_source=x&fbclid=1")).toBe("example.com/a");
    expect(norm("https://example.com/a")).toBe("example.com/a");
    expect(norm("example.com")).toBe("example.com");
  });
  it("keeps query parameters that matter", () => {
    expect(norm("https://youtube.com/watch?v=abc&si=track")).toBe("youtube.com/watch?v=abc");
  });
  it("drops fragments unless they are routes", () => {
    expect(norm("https://example.com/doc#section")).toBe("example.com/doc");
    expect(norm("https://example.com/#/inbox")).toBe("example.com#/inbox");
  });
});

describe("cleanUrl", () => {
  const u = parseUrl("https://example.com/a?utm_medium=mail&id=7")!;
  it("strips tracking only when asked", () => {
    expect(cleanUrl(u, true)).toBe("https://example.com/a?id=7");
    expect(cleanUrl(u, false)).toBe("https://example.com/a?utm_medium=mail&id=7");
  });
});

describe("parseUrl and looksLikeUrl", () => {
  it("accepts bare domains and rejects other schemes", () => {
    expect(parseUrl("example.com/x")?.href).toBe("https://example.com/x");
    expect(parseUrl("javascript:alert(1)")).toBeNull();
    expect(parseUrl("mailto:a@example.com")).toBeNull();
  });
  it("tells an address from a search", () => {
    expect(looksLikeUrl("example.com/path?x=1")).toBe(true);
    expect(looksLikeUrl("https://example.com")).toBe(true);
    expect(looksLikeUrl("heat pump sizing")).toBe(false);
    expect(looksLikeUrl("hono")).toBe(false);
  });
});

describe("cleanTags", () => {
  it("lowercases, splits and removes duplicates", () => {
    expect(cleanTags("Dev, #Linux  dev Żółw")).toEqual(["dev", "linux", "żółw"]);
  });
});

describe("decode", () => {
  it("turns HTML entities into text", () => {
    expect(decode("Tom &amp; Jerry &#8211; caf&#xe9; &quot;x&quot; &unknown;")).toBe('Tom & Jerry \u2013 caf\u00e9 "x" &unknown;');
  });
});

describe("folderTags", () => {
  it("drops the browser's own top level folders and joins words", () => {
    expect(folderTags(["Bookmarks bar", "Dev Tools", " House "])).toEqual(["dev-tools", "house"]);
    expect(folderTags(["Favorites", "Other Bookmarks"])).toEqual([]);
  });
});

describe("localPath", () => {
  it("accepts paths on this site", () => {
    expect(localPath("/")).toBe("/");
    expect(localPath("/list?view=later&page=2")).toBe("/list?view=later&page=2");
    expect(localPath("/list?q=https://example.com")).toBe("/list?q=https://example.com");
  });
  it("rejects anything that could lead elsewhere", () => {
    for (const to of ["", "list", "https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "javascript:alert(1)", " /list"]) {
      expect(localPath(to), JSON.stringify(to)).toBeNull();
    }
  });
});
