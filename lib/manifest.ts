/**
 * Farcaster Mini App manifest (v2).
 * Webhook notification secrets are server-side env vars, not manifest fields.
 */
export const FARCASTER_ACCOUNT_ASSOCIATION = {
  header:
    'eyJmaWQiOjI0MDk1OSwidHlwZSI6ImN1c3RvZHkiLCJrZXkiOiIweDU3RjUxZUE2NzhGOWU4MDNGMUZCNWIwNjQxOGEyYjI0YTdmYzVmNzUifQ',
  payload: 'eyJkb21haW4iOiJzb3VuZGZyYW1lLnZlcmNlbC5hcHAifQ',
  signature:
    'i+8KKO83+nUovwEFKqUWFKxT8aqsLrzpxQPrUaT6Xy8QiYvV4A/rpqu1lUtJJBpZpexl+7sJBr//4vpMvJdzDhw=',
} as const

export const FARCASTER_MINIAPP_CONFIG = {
  version: '1',
  name: 'SoundFrame',
  description:
    'Share SoundCloud tracks in Farcaster with an embedded player. Paste a link and play in-app.',
  subtitle: 'SoundCloud for Farcaster',
  primaryCategory: 'music',
  tags: ['music', 'soundcloud', 'player'],
  splashBackgroundColor: '#121212',
} as const

export function buildFarcasterManifest(origin: string) {
  const base = origin.replace(/\/$/, '')
  const miniapp = {
    ...FARCASTER_MINIAPP_CONFIG,
    iconUrl: `${base}/splash.png`,
    homeUrl: `${base}/player`,
    splashImageUrl: `${base}/splash.png`,
  }
  return {
    accountAssociation: FARCASTER_ACCOUNT_ASSOCIATION,
    miniapp,
    frame: miniapp,
  }
}

export function isFarcasterManifestRequest(request: Request) {
  const { pathname } = new URL(request.url)
  return (
    pathname === '/.well-known/farcaster.json' ||
    pathname === '/api/.well-known/farcaster.json'
  )
}

export function farcasterManifestResponse(request: Request) {
  const origin = new URL(request.url).origin
  return new Response(JSON.stringify(buildFarcasterManifest(origin)), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
