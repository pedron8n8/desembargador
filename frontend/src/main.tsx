import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import './estilo/tokens.css'
import './estilo/app.css'
import './estilo/viz.css'

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // O acervo tem 20 mil decisões que não mudam enquanto o servidor roda;
      // refetch a cada foco de janela seria trabalho por nada.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (n, e: any) => (e?.status === 401 || e?.status === 404 ? false : n < 2),
    },
  },
})

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
