import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: { alias: { '@shared': resolve(root, 'src/shared') } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
