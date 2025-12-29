// Static assets served inline (base64 encoded)
// These are embedded at build time for simplicity

const STATIC_ASSETS: Record<string, { contentType: string }> = {
  '/favicon.ico': { contentType: 'image/x-icon' },
  '/favicon-16x16.png': { contentType: 'image/png' },
  '/favicon-32x32.png': { contentType: 'image/png' },
  '/apple-touch-icon.png': { contentType: 'image/png' },
  '/logo.png': { contentType: 'image/png' },
  '/logo-squared.png': { contentType: 'image/png' }
}

export function handleStaticAsset(path: string): Response | null {
  const asset = STATIC_ASSETS[path]
  if (!asset) return null

  // For now, return a redirect to a CDN or placeholder
  // In production, you'd use Cloudflare Pages or R2 for static assets

  // Return 404 for now - assets should be served via Cloudflare Pages or external CDN
  return new Response('Asset not found - use external CDN', {
    status: 404,
    headers: { 'Content-Type': 'text/plain' }
  })
}

// Check if a path is a known static asset
export function isStaticAsset(path: string): boolean {
  return path in STATIC_ASSETS
}
