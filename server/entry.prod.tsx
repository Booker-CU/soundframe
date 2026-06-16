import { app } from '../lib/app.js'

export const config = {
  runtime: 'edge',
}

export default (request: Request) => app.fetch(request)
