#!/usr/bin/env node
// Tiny CLI for AceDeck's local automation API.
//   node scripts/ctl.mjs GET /status
//   node scripts/ctl.mjs POST /jobs '{"params":{"prompt":"lo-fi, piano","instrumental":true},"count":2,"batchSize":1}'
//   node scripts/ctl.mjs POST /ui/screenshot '{"path":"C:/tmp/shot.png"}'   (dev builds)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const file = process.env.ACEDECK_CONTROL_FILE ?? join(process.env.APPDATA ?? join(os.homedir(), 'AppData', 'Roaming'), 'AceDeck', 'control.json')
const { port, token } = JSON.parse(readFileSync(file, 'utf8'))
const [method = 'GET', rawPath = 'status', body] = process.argv.slice(2)
// Accept "status" as well as "/status" (Git Bash rewrites leading-slash args into Windows paths).
const path = '/' + rawPath.replace(/^.*?(?=(status|engine|jobs|queue|tracks|diagnostics|models|ai|ui)\b)/, '').replace(/^\/+/, '')
const res = await fetch(`http://127.0.0.1:${port}${path}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body,
})
const json = await res.json()
console.log(JSON.stringify(json.ok ? json.data : json, null, 2))
process.exit(json.ok ? 0 : 1)
