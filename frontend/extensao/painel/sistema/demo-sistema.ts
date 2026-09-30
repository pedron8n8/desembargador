import type { Acompanhado, ApiSistema, ItemHistorico } from './apiSistema.ts'

const PROC = '50012345620208240023' // o processo do cenário de demonstração

const HISTORICO: ItemHistorico[] = [
  { thread: 'demo-h2', criado_em: '2026-09-21T10:00:00', resumo: '', cerebro_nome: 'Desembargador Rubens Schulz', estado: 'pronto', decide: true, probabilidade_pct: 63 },
  { thread: 'demo-h1', criado_em: '2026-09-02T15:30:00', resumo: '', cerebro_nome: 'Desembargador Rubens Schulz', estado: 'pronto', decide: false, probabilidade_pct: null },
]

/** O servidor de mentira da demonstração: tudo em memória, nada sai da página. */
export function apiSistemaDemo(): ApiSistema {
  let lista: Acompanhado[] = [{ processo: '50099998820238240008', instancia: '1g', criado_em: '2026-09-10T09:00:00' }]
  return {
    historico: async (p) => (p === PROC ? HISTORICO : []),
    acompanhados: async () => lista,
    async acompanhar(processo, instancia) {
      if (!lista.some((a) => a.processo === processo)) lista = [{ processo, instancia, criado_em: '2026-09-30T12:00:00' }, ...lista]
    },
    async parar(processo) { lista = lista.filter((a) => a.processo !== processo) },
    urlDoHistorico: (p) => `demo://historico/${p}`,
    urlDaConsulta: (t) => `demo://consulta/${t}`,
  }
}
