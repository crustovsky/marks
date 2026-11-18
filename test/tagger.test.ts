// The tagger against a stubbed Messages API: what it makes of the model's answer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { suggestTags, suggestTagsBulk } from "../worker/tagger";

const cfg = { title: "marks", tagModel: "claude-haiku-5-5", apiKey: "test" };
const pages = [
  { id: 1, url: "https://example.com/a", title: "A" },
  { id: 2, url: "https://example.com/b", title: "B" },
];

// Answers every request with these content blocks, or with an error status.
function answer(content: unknown[], status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ content }), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("suggestTags", () => {
  it("reads the text block that follows a thinking block", async () => {
    answer([{ type: "thinking", thinking: "" }, { type: "text", text: '["Dev", "linux"]' }]);
    expect(await suggestTags(cfg, pages[0], [])).toEqual(["dev", "linux"]);
  });

  it("gives nothing when the call fails or the key is unset", async () => {
    const fetch = answer([], 500);
    expect(await suggestTags(cfg, pages[0], [])).toEqual([]);
    expect(await suggestTags({ ...cfg, apiKey: "" }, pages[0], [])).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("suggestTagsBulk", () => {
  it("asks once and keeps only the ids it asked about", async () => {
    const fetch = answer([{ type: "text", text: 'Here you go:\n```json\n{"1": ["Dev", "a b", "x", "y"], "2": [], "99": ["nope"]}\n```' }]);
    expect(await suggestTagsBulk(cfg, pages, ["dev"])).toEqual([{ id: 1, tags: ["dev", "ab", "x"] }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is null when the call fails or the answer is not JSON, so the caller can stop", async () => {
    answer([], 529);
    expect(await suggestTagsBulk(cfg, pages, [])).toBeNull();
    answer([{ type: "text", text: "sorry" }]);
    expect(await suggestTagsBulk(cfg, pages, [])).toBeNull();
  });
});
