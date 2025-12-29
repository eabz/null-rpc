// Root handler - with static assets configured in wrangler.jsonc,
// index.html will be served automatically by Cloudflare.
// This handler is a fallback for programmatic access.

export function handleRoot(): Response {
  // When using Cloudflare's assets feature, index.html is auto-served
  // This handler acts as fallback for API-style requests
  return new Response('NullRPC API', {
    headers: {
      'Content-Type': 'text/plain'
    }
  })
}
