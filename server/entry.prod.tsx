import { app } from '../lib/app.js'

function handle(request: Request) {
  return app.fetch(request)
}

// Vercel Node.js: bare `export default (req) =>` is legacy (req, res) syntax.
// Use Web API `{ fetch }` or named method exports instead.
export default { fetch: handle }

export const GET = handle
export const POST = handle
