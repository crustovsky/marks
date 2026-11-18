import { describe, expect, it } from "vitest";
import { parseBookmarks } from "../worker/import";
import { cleanTags, cleanUrl, looksLikeUrl, normalizeUrl, parseUrl } from "../worker/url";

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

describe("parseBookmarks", () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://example.com/" ADD_DATE="1700000000">Example &amp; Co</A>
    <DT><H3>Dev Tools</H3>
    <DL><p>
      <DT><A HREF="https://example.org/docs?utm_source=x">Docs</A>
      <DT><A HREF="place:sort=8">Most visited</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://example.net/">Loose</A>
</DL><p>`;
  it("reads links, dates and folder names as tags", () => {
    expect(parseBookmarks(html)).toEqual([
      { url: "https://example.com/", title: "Example & Co", tags: [], created: 1700000000 },
      { url: "https://example.org/docs?utm_source=x", title: "Docs", tags: ["dev-tools"], created: 0 },
      { url: "https://example.net/", title: "Loose", tags: [], created: 0 },
    ]);
  });
});
