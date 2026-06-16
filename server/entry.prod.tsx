import { app } from '../lib/app.js'

// Frog depends on @vercel/og WASM — Node.js runtime, not Edge.
export default (request: Request) => app.fetch(request)
