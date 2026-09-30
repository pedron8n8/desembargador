import { del, get, put, type ItemLista } from '../../../src/api.ts'
import type { ApiSistema } from './apiSistema.ts'

// Sem teste de Node: importa o cliente do site, que usa import.meta.env (ver analisar/apiReal.ts).
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export const apiSistemaReal: ApiSistema = {
  async historico(processo) {
    return (await get<{ itens: ItemLista[] }>(`/api/consultas?eproc=${processo}&por_pagina=20`)).itens
  },
  async acompanhados() {
    return (await get<{ itens: Awaited<ReturnType<ApiSistema['acompanhados']>> }>('/api/acompanhados')).itens
  },
  async acompanhar(processo, instancia) {
    await put(`/api/acompanhados/${processo}`, { instancia })
  },
  async parar(processo) {
    await del(`/api/acompanhados/${processo}`)
  },
  urlDoHistorico: (processo) => `${BASE}/?eproc=${processo}`,
  urlDaConsulta: (thread) => `${BASE}/consulta/${thread}`,
}
