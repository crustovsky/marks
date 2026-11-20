// Turns the string vars from wrangler.jsonc into typed config with defaults.

export interface Config {
  title: string;
  tagModel: string;
  apiKey: string; // empty turns tag suggestions off
  iconService: string; // empty keeps icon lookups to the bookmarked sites themselves
}

// ICON_SERVICE is named here as well because the types are generated from the
// config in use, and a wrangler.local.jsonc from before the setting lacks it.
export function loadConfig(env: Env & { ICON_SERVICE?: string }): Config {
  return {
    title: String(env.SITE_TITLE || "marks"),
    tagModel: String(env.TAG_MODEL || "claude-haiku-5-5"),
    apiKey: String(env.ANTHROPIC_API_KEY ?? ""),
    iconService: String(env.ICON_SERVICE ?? ""),
  };
}
