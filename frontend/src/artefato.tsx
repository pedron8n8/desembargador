/* Entrada do ARTEFATO: a apresentação num arquivo HTML só.
 *
 * Mesma página, mesmos componentes, mesmo CSS — o que muda é de onde vêm os
 * dados. Aqui os três JSON viajam dentro do próprio HTML e um remendo no fetch
 * os entrega, então não há API atrás, não há cookie e não há portão de senha.
 *
 * Isso importa saber: o artefato NÃO é protegido. Quem abrir o arquivo vê a
 * apresentação inteira. O portão continua existindo em /apresentacao, que é a
 * rota servida pela API.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { Apresentacao } from './paginas/Apresentacao'
import './estilo/tokens.css'
import './estilo/app.css'
import './estilo/viz.css'

declare global {
  interface Window {
    __APRESENTACAO__?: unknown
  }
}

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } })

const original = window.fetch.bind(window)
window.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
  const rota = typeof entrada === 'string' ? entrada
    : entrada instanceof URL ? entrada.href : entrada.url
  if (rota.includes('/api/apresentacao/estado')) {
    return Promise.resolve(json({ habilitada: false, autenticado: true }))
  }
  if (rota.includes('/api/apresentacao/dados')) {
    return Promise.resolve(json(window.__APRESENTACAO__))
  }
  return original(entrada, init)
}) as typeof window.fetch

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: Infinity, retry: false } },
})

createRoot(document.getElementById('raiz')!).render(
  <QueryClientProvider client={qc}>
    <Apresentacao />
  </QueryClientProvider>,
)
