import { get, post, type Consulta, type ListaCerebros } from '../../../src/api.ts'
import type { ApiAnalise } from './apiAnalise.ts'
import { lerStream } from './sse.ts'

// Mesmo padrão do cliente do site (src/api.ts): VITE_API_BASE prefixa a rota e o
// cookie vai com credentials: 'include' (o painel é uma página chrome-extension://).
// Não tem teste de Node: importa o cliente do site, que usa import.meta.env.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export const apiReal: ApiAnalise = {
  cerebros: () => get<ListaCerebros>('/api/cerebros'),
  async limiteDoCaso() {
    const c = await get<{ busca?: { max_chars_caso?: number } }>('/api/config')
    return c.busca?.max_chars_caso ?? 20000
  },
  async extrair(nome, base64) {
    return (await post<{ texto: string }>('/api/extrair', { nome, dados: base64 })).texto
  },
  rodar: (corpo) => post<{ thread: string }>('/api/consultas', corpo),
  async acompanhar(thread, aoEvento) {
    // fetch + stream, e não EventSource: o cookie entre origens não é confiável nele
    const r = await fetch(`${BASE}/api/consultas/${thread}/eventos`, {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
    })
    if (!r.ok || !r.body) throw new Error('Não foi possível acompanhar a consulta.')
    await lerStream(r.body, aoEvento)
  },
  consulta: (thread) => get<Consulta>(`/api/consultas/${thread}`),
  urlDoSite: (thread) => `${BASE}/consulta/${thread}`,
}
