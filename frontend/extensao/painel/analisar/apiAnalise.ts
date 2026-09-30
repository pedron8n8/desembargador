import type { Consulta, ListaCerebros } from '../../../src/api.ts'
import { minimizar } from '../../agente/lib/minimizacao.ts'
import type { EventoSse } from './sse.ts'

export type Origem = { eproc: string; instancia: '1g' | '2g' }
export type Tese = 'neutra' | 'reformar' | 'manter'

/** O corpo de POST /api/consultas (ver `rodar` e `_pedido` em api/app.py). */
export type CorpoConsulta = { caso: string; tese: Tese; cerebro: string; so_prognostico: boolean; origem: Origem }

/** O que o painel usa do nosso servidor. A implementação real fica em apiReal.ts; a demonstração tem a sua. */
export type ApiAnalise = {
  cerebros(): Promise<ListaCerebros>
  /** `busca.max_chars_caso` de GET /api/config: quantos caracteres do caso o pipeline lê. */
  limiteDoCaso(): Promise<number>
  /** PDF e afins -> texto, por POST /api/extrair. */
  extrair(nome: string, base64: string): Promise<string>
  rodar(corpo: CorpoConsulta): Promise<{ thread: string }>
  /** Entrega os eventos da consulta e só resolve quando o servidor fecha o stream. */
  acompanhar(thread: string, aoEvento: (e: EventoSse) => void): Promise<void>
  consulta(thread: string): Promise<Consulta>
  urlDoSite(thread: string): string
}

/** O servidor recusa com 413 acima disto (`MAX_CHARS_CASO` em api/app.py); recusamos antes de enviar. */
export const LIMITE_ENVIO = 120_000

/**
 * Monta o corpo da consulta. O texto é minimizado DE NOVO aqui (é idempotente):
 * o advogado pode ter editado o caso à mão depois da montagem, e este é o último
 * ponto antes de a rede.
 */
export function corpoDaConsulta(o: { texto: string; cerebro: string; tese: Tese; soPrognostico: boolean; origem: Origem }): CorpoConsulta {
  const caso = minimizar(o.texto).trim()
  if (!caso) throw new Error('O caso está vazio.')
  if (!o.cerebro) throw new Error('Escolha o cérebro que vai analisar.')
  if (caso.length > LIMITE_ENVIO) {
    throw new RangeError(`Caso longo demais: ${caso.length} caracteres (máximo ${LIMITE_ENVIO}). Desmarque peças ou corte o texto.`)
  }
  return { caso, tese: o.tese, cerebro: o.cerebro, so_prognostico: o.soPrognostico, origem: o.origem }
}
