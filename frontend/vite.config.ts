import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// O proxy é o que mantém tudo same-origin em dev: sem ele haveria CORS para
// configurar E o cookie de sessão viraria cross-site (SameSite=Lax o barraria).
// Em produção o FastAPI serve o dist/ e o proxy deixa de existir.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
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
