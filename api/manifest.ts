export const FARCASTER_MANIFEST = {
  accountAssociation: {
    header: 'eyJhbGciOiJFUzI1NksifQ',
    payload: 'eyJkb21haW4iOiJsb2NhbGhvc3Q6NTE3MyJ9',
    signature: 'MEYCIQCc9M...',
  },
  frame: {
    version: '1',
    name: 'SoundFrame',
    iconUrl: 'http://localhost:5173/icon.png',
    homeUrl: 'http://localhost:5173/player/demo',
    splashImageUrl: 'http://localhost:5173/icon.png',
    splashBackgroundColor: '#121212',
  },
} as const

export function isFarcasterManifestRequest(request: Request) {
  return new URL(request.url).pathname === '/.well-known/farcaster.json'
}

export function farcasterManifestResponse() {
  return new Response(JSON.stringify(FARCASTER_MANIFEST), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
