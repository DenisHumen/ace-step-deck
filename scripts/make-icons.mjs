// Renders build/icon.svg into the PNG/ICO assets used by Electron and electron-builder.
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(resolve(root, 'build/icon.svg'))
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

writeFileSync(resolve(root, 'build/icon.png'), render(512))
mkdirSync(resolve(root, 'src/renderer/public'), { recursive: true })
writeFileSync(resolve(root, 'src/renderer/public/icon.png'), render(256))
const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map(render))
writeFileSync(resolve(root, 'build/icon.ico'), ico)
console.log('icons written: build/icon.png, build/icon.ico, src/renderer/public/icon.png')
