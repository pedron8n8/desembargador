import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { montarManifest } from './extensao/manifest.ts'

// Painel + service worker saem daqui, em ES modules. O agente (content script)
// NÃO: content script não pode ser módulo, então sai do esbuild em IIFE (ver
// o script build:extensao no package.json).
const API_BASE = process.env.EXT_API_BASE ?? ''
const manifest = montarManifest(API_BASE) // falha o build cedo se faltar a env
const raiz = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: raiz('./extensao'),
  plugins: [
    react(),
    {
      name: 'manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) })
      },
    },
  ],
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(new URL(API_BASE).origin) },
  build: {
    outDir: raiz('./extensao/dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { painel: raiz('./extensao/painel.html'), sw: raiz('./extensao/sw.ts') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
})
