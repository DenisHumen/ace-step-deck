// Bundles the Electron main process, the preload script and the MCP server with esbuild.
import { build, context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  alias: { '@shared': resolve(root, 'src/shared') },
}

const targets = [
  { ...common, entryPoints: [resolve(root, 'src/main/index.ts')], outfile: resolve(root, 'out/main/index.cjs'), external: ['electron'] },
  { ...common, entryPoints: [resolve(root, 'src/preload/index.ts')], outfile: resolve(root, 'out/preload/index.cjs'), external: ['electron'] },
  // The MCP server is self-contained: it runs under `node` or `ELECTRON_RUN_AS_NODE=1 AceDeck.exe`.
  { ...common, entryPoints: [resolve(root, 'src/mcp/server.ts')], outfile: resolve(root, 'out/mcp/server.cjs'), banner: { js: '#!/usr/bin/env node' } },
]

if (watch) {
  for (const t of targets) await (await context(t)).watch()
} else {
  await Promise.all(targets.map((t) => build(t)))
}
