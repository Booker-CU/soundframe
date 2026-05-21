import { handle } from 'frog/next'
import { app } from '../lib/app.js'
import { devtools } from 'frog/dev'
import { serveStatic } from 'frog/serve-static'

export const config = {
  runtime: 'edge',
}

export { app }

if (process.env.NODE_ENV !== 'production') {
  devtools(app, { serveStatic })
}

export const GET = handle(app)
export const POST = handle(app)
