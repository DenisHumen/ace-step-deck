import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@renderer': resolve(root, 'src/renderer'),
    },
  },
  server: { port: 5199, strictPort: true },
  build: {
    outDir: resolve(root, 'out/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
})
