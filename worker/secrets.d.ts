// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
// Set them with `wrangler secret put <NAME>` or in the dashboard.
interface Env {
  ANTHROPIC_API_KEY?: string;
}
