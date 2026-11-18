// Tag suggestions from the Claude API. Off unless ANTHROPIC_API_KEY is set.

import type { Config } from "./config";
import { cleanTags } from "./url";

export interface TagInput {
  url: string;
  title: string;
  description?: string;
}

export async function suggestTags(cfg: Config, page: TagInput, existing: string[]): Promise<string[]> {
  if (!cfg.apiKey) return [];
  const prompt = [
    "Pick up to 3 tags for this bookmark.",
    "Reuse tags from the existing list whenever one fits. Propose a new tag only when none does.",
    "Tags are single lowercase words. Answer with a JSON array of strings and nothing else.",
    "",
    `Existing tags: ${existing.join(", ") || "(none yet)"}`,
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    page.description ? `Description: ${page.description}` : "",
  ].join("\n");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.tagModel, max_tokens: 60, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ message: "tagger failed", status: res.status }));
      return [];
    }
    const data = (await res.json()) as { content?: { text?: string }[] };
    const match = (data.content?.[0]?.text ?? "").match(/\[[^\]]*\]/);
    const tags: unknown = match ? JSON.parse(match[0]) : [];
    return Array.isArray(tags) ? cleanTags(tags.map(String)).slice(0, 3) : [];
  } catch (e) {
    console.error(JSON.stringify({ message: "tagger failed", error: e instanceof Error ? e.message : String(e) }));
    return [];
  }
}
