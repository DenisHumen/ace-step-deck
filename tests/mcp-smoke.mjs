// End-to-end smoke test of the MCP server, launched exactly like Claude Desktop would.
//   node tests/mcp-smoke.mjs            → list tools + status
//   node tests/mcp-smoke.mjs --generate → also render a 10 s instrumental through generate_music
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// ACEDECK_EXE / ACEDECK_MCP let the test target a packaged build (release/win-unpacked).
const transport = new StdioClientTransport({
  command: process.env.ACEDECK_EXE ?? resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: [process.env.ACEDECK_MCP ?? resolve(root, 'out/mcp/server.cjs')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
const client = new Client({ name: 'acedeck-smoke', version: '1.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
console.log(`tools (${tools.length}):`, tools.map((t) => t.name).join(', '))

const status = await client.callTool({ name: 'acedeck_status', arguments: {} })
const s = JSON.parse(status.content[0].text)
console.log('engine:', s.engine.state, '| gpu:', s.gpu?.name, '| tracks:', s.library.tracks)

if (process.argv.includes('--generate')) {
  const t0 = Date.now()
  const r = await client.callTool({
    name: 'generate_music',
    arguments: { caption: 'mcp smoke test, soft ambient pads, calm', instrumental: true, duration: 10, thinking: false, title: 'MCP smoke test', wait: true },
  })
  const job = JSON.parse(r.content[0].text)
  console.log(`generate_music → ${job.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`, job.tracks?.map((t) => t.file))
  if (job.status !== 'done') process.exitCode = 1
}
await client.close()
