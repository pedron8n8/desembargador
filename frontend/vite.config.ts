import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// O proxy é o que mantém tudo same-origin em dev: sem ele haveria CORS para
// configurar E o cookie de sessão viraria cross-site (SameSite=Lax o barraria).
// Em produção o FastAPI serve o dist/ e o proxy deixa de existir.
// `python -m api.servir --porta 8080` exporta API_PORT antes de subir o Vite.
// Sem isto o proxy ficava preso na 8000 e trocar a porta da API derrubava o dev
// com ECONNREFUSED — sem nenhuma pista de onde vinha.
const API = process.env.API_PORT ?? '8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API}`,
        changeOrigin: false,
        // SSE morre com buffering: o proxy tem de repassar byte a byte
        configure: (proxy) => {
          proxy.on('proxyRes', (res) => {
            if (res.headers['content-type']?.includes('text/event-stream')) {
              res.headers['cache-control'] = 'no-cache'
            }
          })
        },
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
