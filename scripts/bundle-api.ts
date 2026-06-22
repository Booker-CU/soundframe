import * as esbuild from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { buildPlayerHomeEmbed, serializeEmbedForMetaTag } from '../lib/embed.js'
import { buildFarcasterManifest } from '../lib/manifest.js'

function deploymentOrigin() {
  const fromEnv =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    process.env.VERCEL_BRANCH_URL
  if (fromEnv) return `https://${fromEnv.replace(/^https?:\/\//, '')}`
  return 'http://localhost:5173'
}

/**
 * Bundle Frog into `api/index.js` for Vercel Node.
 * `/player` and `/frame` rewrite to `/api/player` and `/api/frame` (see vercel.json).
 * Stub entry files under `api/` map each path to the shared handler.
 * All other `/api/*` paths fall through to `/api` via vercel.json.
 */
rmSync('.vercel/output', { recursive: true, force: true })
rmSync('api/index.js', { force: true })
rmSync('api/[[...path]].js', { force: true })
rmSync('api/frame.js', { force: true })
rmSync('api/frame/image.js', { force: true })
rmSync('api/player.js', { force: true })
rmSync('api/player/[trackId].js', { force: true })
rmSync('api/embed-card.js', { force: true })

const origin = deploymentOrigin()
const embedJson = serializeEmbedForMetaTag(buildPlayerHomeEmbed(origin))

mkdirSync('public/.well-known', { recursive: true })
writeFileSync(
  'public/.well-known/farcaster.json',
  `${JSON.stringify(buildFarcasterManifest(origin), null, 2)}\n`
)

copyFileSync(
  'node_modules/@farcaster/miniapp-sdk/dist/index.min.js',
  'public/miniapp-sdk.js'
)

const playerHtml = readFileSync('lib/player.template.html', 'utf8').replaceAll(
  '__FC_MINIAPP_EMBED__',
  embedJson.replace(/'/g, '&#39;')
)
writeFileSync('public/player.html', playerHtml)

await esbuild.build({
  entryPoints: ['server/entry.prod.tsx'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  jsxImportSource: 'frog/jsx',
  logLevel: 'info',
})

// @vercel/og reads these from import.meta.url next to the bundled output.
for (const asset of ['noto-sans-v27-latin-regular.ttf', 'yoga.wasm', 'resvg.wasm']) {
  copyFileSync(`node_modules/@vercel/og/dist/${asset}`, `api/${asset}`)
}

const { embedCardImageResponse } = await import('../lib/embed-card.tsx')
const embedCardPng = Buffer.from(await (await embedCardImageResponse()).arrayBuffer())
writeFileSync('public/embed-card.png', embedCardPng)

writeFileSync('api/frame.js', "export { default, GET, POST } from './index.js'\n")
mkdirSync('api/frame', { recursive: true })
writeFileSync('api/frame/image.js', "export { default, GET, POST } from '../index.js'\n")

mkdirSync('api/player', { recursive: true })
writeFileSync('api/player.js', "export { default, GET, POST } from './index.js'\n")
writeFileSync('api/player/[trackId].js', "export { default, GET, POST } from '../index.js'\n")
writeFileSync('api/embed-card.js', "export { default, GET, POST } from './index.js'\n")

mkdirSync('api/.well-known', { recursive: true })
writeFileSync(
  'api/.well-known/farcaster.json.js',
  "export { default, GET, POST } from '../index.js'\n"
)
