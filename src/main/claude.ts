// Helpers that wire the bundled MCP server into Claude Desktop / Claude Code.
import { app } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'

export function mcpServerPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'mcp', 'server.cjs') : join(app.getAppPath(), 'out', 'mcp', 'server.cjs')
}

export interface McpConfig {
  command: string
  args: string[]
  env: Record<string, string>
  claudeCodeCommand: string
  desktopJson: string
  desktopConfigPath: string
  desktopInstalled: boolean
}

function desktopConfigPath(): string {
  return join(process.env.APPDATA ?? app.getPath('appData'), 'Claude', 'claude_desktop_config.json')
}

export async function mcpConfig(): Promise<McpConfig> {
  // The Electron binary doubles as a Node runtime, so users need no separate Node.js install.
  const command = process.execPath
  const args = [mcpServerPath()]
  const env = { ELECTRON_RUN_AS_NODE: '1' }
  const q = (s: string) => `"${s}"`
  const claudeCodeCommand = `claude mcp add acedeck --scope user -e ELECTRON_RUN_AS_NODE=1 -- ${q(command)} ${q(args[0])}`
  const desktopJson = JSON.stringify({ mcpServers: { acedeck: { command, args, env } } }, null, 2)
  let desktopInstalled = false
  try {
    const cfg = JSON.parse(await fsp.readFile(desktopConfigPath(), 'utf8'))
    desktopInstalled = !!cfg?.mcpServers?.acedeck
  } catch {
    /* not installed */
  }
  return { command, args, env, claudeCodeCommand, desktopJson, desktopConfigPath: desktopConfigPath(), desktopInstalled }
}

/** Merge the AceDeck server into claude_desktop_config.json (keeps a .bak copy). */
export async function installIntoClaudeDesktop(): Promise<string> {
  const file = desktopConfigPath()
  const cfg = await mcpConfig()
  let current: any = {}
  if (existsSync(file)) {
    const raw = await fsp.readFile(file, 'utf8')
    await fsp.writeFile(`${file}.bak`, raw, 'utf8')
    try {
      current = JSON.parse(raw)
    } catch {
      throw new Error('claude_desktop_config.json is not valid JSON — fix it or add the snippet manually')
    }
  }
  current.mcpServers = { ...(current.mcpServers ?? {}), acedeck: { command: cfg.command, args: cfg.args, env: cfg.env } }
  await fsp.mkdir(join(file, '..'), { recursive: true })
  await fsp.writeFile(file, JSON.stringify(current, null, 2), 'utf8')
  return file
}
