// Tag suggestions from the Claude API. Off unless ANTHROPIC_API_KEY is set.

import type { Config } from "./config";
import { cleanTags } from "./url";

export interface TagInput {
  url: string;
  title: string;
  description?: string;
}

const RULES = [
  "Reuse tags from the existing list whenever one fits. Propose a new tag only when none does.",
  "Tags are single lowercase words.",
];

// One request to the Messages API. The text of the answer, or null when the call failed.
async function ask(cfg: Config, prompt: string, maxTokens: number, timeout: number): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.tagModel, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ message: "tagger failed", status: res.status }));
      return null;
    }
    // The answer is the text block; models that think put a thinking block before it.
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] };
    return data.content?.find((b) => b.type === "text")?.text ?? "";
  } catch (e) {
    console.error(JSON.stringify({ message: "tagger failed", error: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

// The first JSON value of the given kind in the answer, which may come wrapped in prose or a code fence.
function parse(text: string, kind: RegExp): unknown {
  try {
    const match = text.match(kind);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

export async function suggestTags(cfg: Config, page: TagInput, existing: string[]): Promise<string[]> {
  if (!cfg.apiKey) return [];
  const prompt = [
    "Pick up to 3 tags for this bookmark.",
    ...RULES,
    "Answer with a JSON array of strings and nothing else.",
    "",
    `Existing tags: ${existing.join(", ") || "(none yet)"}`,
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    page.description ? `Description: ${page.description}` : "",
  ].join("\n");
  // Room for the model to think before the few tokens of the answer.
  const tags = parse((await ask(cfg, prompt, 1000, 10000)) ?? "", /\[[^\]]*\]/);
  return Array.isArray(tags) ? cleanTags(tags.map(String)).slice(0, 3) : [];
}

export interface BulkInput {
  id: number;
  url: string;
  title: string;
}

// Tags for many bookmarks in one request, because a Worker request may only make
// a few dozen of its own. Bookmarks the model had nothing for are left out.
// Null when the call failed, so the caller can stop instead of skipping them.
export async function suggestTagsBulk(cfg: Config, pages: BulkInput[], existing: string[]): Promise<{ id: number; tags: string[] }[] | null> {
  if (!cfg.apiKey) return null;
  if (!pages.length) return [];
  const prompt = [
    "Pick 1 to 3 tags for each of these bookmarks. Every bookmark gets at least one; when the title says little, go by the address.",
    ...RULES,
    "Use the same tag for bookmarks about the same thing.",
    'Answer with one JSON object that maps each id to its array of tags, like {"12": ["dev", "linux"]}, and nothing else.',
    "",
    `Existing tags: ${existing.join(", ") || "(none yet)"}`,
    "",
    "Bookmarks, one per line as id, address, title:",
    ...pages.map((p) => `${p.id}\t${p.url.slice(0, 300)}\t${p.title.replace(/\s+/g, " ").slice(0, 200)}`),
  ].join("\n");
  const text = await ask(cfg, prompt, 8000, 60000);
  if (text === null) return null;
  const answer = parse(text, /\{[\s\S]*\}/);
  if (!answer || typeof answer !== "object") return null;
  // Only ids that were asked about: titles are untrusted and the model can be talked into anything.
  const byId = answer as Record<string, unknown>;
  return pages
    .map((p) => {
      const tags = byId[String(p.id)];
      return { id: p.id, tags: Array.isArray(tags) ? cleanTags(tags.map(String)).slice(0, 3) : [] };
    })
    .filter((r) => r.tags.length);
}
