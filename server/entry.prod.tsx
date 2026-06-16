import { app } from '../lib/app.js'

export const config = {
  runtime: 'edge',
}

export default app.fetch.bind(app)
