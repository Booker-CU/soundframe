import { handle } from 'frog/next'
import { app } from '../index.js'
import { devtools } from 'frog/dev'
import { serveStatic } from 'frog/serve-static'

export const config = {
  runtime: 'edge',
}

export { app }

devtools(app, { serveStatic })

export const GET = handle(app)
export const POST = handle(app)
