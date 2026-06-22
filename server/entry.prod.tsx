import { app } from '../lib/app.js'

function normalizeRequestUrl(request: Request): Request {
  const url = new URL(request.url)
  if (
    url.pathname === '/frame' ||
    url.pathname.startsWith('/frame/') ||
    url.pathname === '/player' ||
    url.pathname.startsWith('/player/')
  ) {
    url.pathname = `/api${url.pathname}`
    return new Request(url, request)
  }
  return request
}

async function handle(request: Request): Promise<Response> {
  try {
    return await app.fetch(normalizeRequestUrl(request))
  } catch (err) {
    console.error('SoundFrame handler error:', err)
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    return new Response(message, { status: 500, headers: { 'Content-Type': 'text/plain' } })
  }
}

// Vercel Node: Web API handler (also works as named GET/POST on /api).
export default { fetch: handle }

export const GET = handle
export const POST = handle
