// Turns the string vars from wrangler.jsonc into typed config with defaults.

export interface Config {
  title: string;
  tagModel: string;
  apiKey: string; // empty turns tag suggestions off
}

export function loadConfig(env: Env): Config {
  return {
    title: String(env.SITE_TITLE || "marks"),
    tagModel: String(env.TAG_MODEL || "claude-haiku-5-5"),
    apiKey: String(env.ANTHROPIC_API_KEY ?? ""),
  };
}
