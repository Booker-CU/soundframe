import { handle } from 'frog/next'
import { app } from '../lib/app.js'

export const config = {
  runtime: 'edge',
}

export { app }

export const GET = handle(app)
export const POST = handle(app)
