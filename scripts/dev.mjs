// Dev runner: Vite dev server for the renderer + esbuild watch for main/preload + Electron.
import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({ configFile: resolve(root, 'vite.config.mts') })
await server.listen()
const url = server.resolvedUrls.local[0]

const esb = spawn(process.execPath, [resolve(root, 'scripts/build-electron.mjs'), '--watch'], { stdio: 'inherit' })
while (!existsSync(resolve(root, 'out/main/index.cjs'))) await new Promise((r) => setTimeout(r, 200))
await new Promise((r) => setTimeout(r, 500))

const electronBin = resolve(root, 'node_modules/electron/dist/electron.exe')
const app = spawn(electronBin, ['.', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url, ACEDECK_DEV: '1' },
})
app.on('exit', async (code) => {
  esb.kill()
  await server.close()
  process.exit(code ?? 0)
})
