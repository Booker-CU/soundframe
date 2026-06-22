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
 * `/player` is static `public/player.html` (see vercel.json rewrites).
 * All `/api/*` paths are rewritten to `/api` — catch-all `[[...path]].js` is Next.js-only.
 */
rmSync('.vercel/output', { recursive: true, force: true })
rmSync('api/index.js', { force: true })
rmSync('api/[[...path]].js', { force: true })
rmSync('api/frame.js', { force: true })
rmSync('api/frame/image.js', { force: true })

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

writeFileSync('api/frame.js', "export { default, GET, POST } from './index.js'\n")
mkdirSync('api/frame', { recursive: true })
writeFileSync('api/frame/image.js', "export { default, GET, POST } from '../index.js'\n")
