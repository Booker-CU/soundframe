/**
 * Farcaster Mini App manifest (v2).
 * Replace accountAssociation via Farcaster Developer Tools before production validation.
 * Webhook notification secrets are server-side env vars, not manifest fields.
 */
export const FARCASTER_ACCOUNT_ASSOCIATION_STUB = {
  header: 'eyJhbGciOiJFUzI1NksifQ',
  payload: 'eyJkb21haW4iOiJZT1VSX0RPTUFJTiJ9',
  signature: 'REPLACE_WITH_SIGNED_ACCOUNT_ASSOCIATION',
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
    accountAssociation: FARCASTER_ACCOUNT_ASSOCIATION_STUB,
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
