import * as esbuild from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

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
 * Vercel Edge Functions cannot import modules outside `api/` (e.g. `../lib/*`).
 * Bundle local sources into a single `api/[[...path]].js` for the `api/` route.
 *
 * Do not run `frog vercel-build`: it writes `.vercel/output/config.json` (Build
 * Output API) with stub `.func` dirs missing `.vc-config.json`, which breaks deploy.
 */
rmSync('.vercel/output', { recursive: true, force: true })
rmSync('api/index.js', { force: true })

mkdirSync('public/.well-known', { recursive: true })
writeFileSync(
  'public/.well-known/farcaster.json',
  `${JSON.stringify(buildFarcasterManifest(deploymentOrigin()), null, 2)}\n`
)

await esbuild.build({
  entryPoints: ['server/entry.prod.tsx'],
  outfile: 'api/[[...path]].js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
  jsxImportSource: 'frog/jsx',
  logLevel: 'info',
})
