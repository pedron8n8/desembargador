import type { Acompanhado, ItemLista } from '../../../src/api.ts'

export type Instancia = '1g' | '2g'
/** O que o painel usa de cada consulta do histórico (GET /api/consultas?eproc=). */
export type ItemHistorico = Pick<ItemLista, 'thread' | 'criado_em' | 'resumo' | 'cerebro_nome' | 'estado' | 'decide' | 'probabilidade_pct'>
export type { Acompanhado }

/** A ligação painel <-> sistema (seção 5): histórico por processo e processos acompanhados. */
export type ApiSistema = {
  /** Consultas deste processo, da mais nova para a mais antiga (só as do próprio usuário). */
  historico(processo: string): Promise<ItemHistorico[]>
  acompanhados(): Promise<Acompanhado[]>
  acompanhar(processo: string, instancia: Instancia): Promise<void>
  parar(processo: string): Promise<void>
  /** Página do site com as consultas do processo. */
  urlDoHistorico(processo: string): string
  urlDaConsulta(thread: string): string
}

export const ehAcompanhado = (lista: Acompanhado[], processo: string) => lista.some((a) => a.processo === processo)

const dia = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * As duas linhas de cada consulta no histórico. O percentual só aparece quando o servidor
 * decidiu: `decide === false` é "não decidiu", nunca um número.
 */
export function linhaDoHistorico(i: ItemHistorico): { titulo: string; estado: string } {
  const titulo = [dia(i.criado_em), i.cerebro_nome].filter(Boolean).join(' · ')
  let estado: string
  if (i.estado === 'fila' || i.estado === 'rodando') estado = 'rodando'
  else if (i.estado === 'interrompido') estado = 'interrompida'
  else if (i.estado === 'erro') estado = 'erro'
  else if (i.decide === false) estado = 'não decidiu'
  else if (i.probabilidade_pct != null) estado = `${Math.round(i.probabilidade_pct)}% de reforma`
  else estado = '—'
  return { titulo, estado }
}
