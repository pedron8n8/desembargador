import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { montarManifest } from './extensao/manifest.ts'

// Painel + service worker saem daqui, em ES modules. O agente (content script)
// NÃO: content script não pode ser módulo, então sai do esbuild em IIFE (ver
// extensao/build.mjs, chamado pelo script build:extensao).
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
    // emptyOutDir apaga a pasta: EXT_OUT_DIR deve apontar para uma pasta descartável.
    outDir: process.env.EXT_OUT_DIR ?? raiz('./extensao/dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        painel: raiz('./extensao/painel.html'),
        sw: raiz('./extensao/sw.ts'),
        // Página de demonstração com dados fictícios: só no build de apresentação,
        // nunca no pacote da loja.
        ...(process.env.EXT_DEMO === '1' ? { demo: raiz('./extensao/demo.html') } : {}),
      },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
})
