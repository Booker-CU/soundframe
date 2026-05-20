import { handle } from 'frog/next'
import { app } from '../index.js'
import { devtools } from 'frog/dev'
import { serveStatic } from 'frog/serve-static'
import { farcasterManifestResponse, isFarcasterManifestRequest } from './manifest.js'

export const config = {
  runtime: 'edge',
}

// Frog mounts routes under basePath `/api`, but Farcaster requires
// `/.well-known/farcaster.json` at the domain root.
const frogFetch = app.fetch.bind(app)
app.fetch = async (request, env, executionCtx) => {
  if (isFarcasterManifestRequest(request)) {
    return farcasterManifestResponse()
  }
  return frogFetch(request, env, executionCtx)
}

export { app }

devtools(app, { serveStatic })

export const GET = handle(app)
export const POST = handle(app)
