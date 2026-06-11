import * as esbuild from 'esbuild'

import { rmSync } from 'node:fs'

/**
 * Vercel Edge Functions cannot import modules outside `api/` (e.g. `../lib/*`).
 * Bundle local sources into a single `api/index.tsx` for the `api/` route.
 *
 * Do not run `frog vercel-build`: it writes `.vercel/output/config.json` (Build
 * Output API) with stub `.func` dirs missing `.vc-config.json`, which breaks deploy.
 */
rmSync('.vercel/output', { recursive: true, force: true })
await Promise.all([
  esbuild.build({
    entryPoints: ['server/entry.prod.tsx'],
    outfile: 'api/index.js',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    jsxImportSource: 'frog/jsx',
    logLevel: 'info',
  }),
  esbuild.build({
    entryPoints: ['lib/client/main.tsx'],
    outfile: 'public/client.js',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    jsxImportSource: 'react',
    logLevel: 'info',
  }),
])
