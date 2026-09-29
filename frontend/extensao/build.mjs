// Build da extensão: painel + service worker pelo Vite (ES modules) e o agente
// (content script, que não pode ser módulo) pelo esbuild em IIFE. Ambos saem em
// EXT_OUT_DIR, se definida, senão em extensao/dist.
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { build as esbuild } from 'esbuild'

const aqui = (p) => fileURLToPath(new URL(p, import.meta.url))
const outDir = process.env.EXT_OUT_DIR ?? aqui('./dist')

await build({ configFile: aqui('../vite.extensao.config.ts') })
await esbuild({
  entryPoints: [aqui('./agente/index.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  outfile: outDir + '/agente.js',
})
