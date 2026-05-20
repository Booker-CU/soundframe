export const FARCASTER_MANIFEST = {
  accountAssociation: {
    header: 'eyJhbGciOiJFUzI1NksifQ',
    payload: 'eyJkb21haW4iOiJsb2NhbGhvc3Q6NTE3MyJ9',
    signature: 'MEYCIQCc9M...',
  },
  frame: {
    version: '1',
    name: 'SoundFrame',
    splashBackgroundColor: '#121212',
  },
} as const

export function buildFarcasterManifest(origin: string) {
  const base = origin.replace(/\/$/, '')
  return {
    ...FARCASTER_MANIFEST,
    frame: {
      ...FARCASTER_MANIFEST.frame,
      iconUrl: `${base}/splash.png`,
      homeUrl: `${base}/frame`,
      splashImageUrl: `${base}/splash.png`,
    },
  }
}

export function isFarcasterManifestRequest(request: Request) {
  return new URL(request.url).pathname === '/.well-known/farcaster.json'
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
