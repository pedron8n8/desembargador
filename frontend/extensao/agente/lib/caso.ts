// Contrato entre o agente (que lê o eproc) e o painel (que monta o caso). As
// primitivas de rede da B vão PRODUZIR estes tipos a partir do HTML do TJSC;
// enquanto elas não existem, o resto da B trabalha só contra o contrato.

/** Uma peça (documento) na lista de eventos do processo. */
export type Peca = {
  ref: string // referência opaca; a URL assinada (doc, evento, key, hash) fica só no agente
  tipo: string // data-nome do eproc: 'SENT', 'DESPADEC', 'INIC'...
  rotulo: string // nome amigável, ex.: 'SENTENÇA 1'
  evento: number // número do evento; cresce com o tempo. Quem produz converte com Number() e trata NaN como erro LAYOUT (a seleção compara com > e <, e um NaN a quebraria em silêncio)
  data: string // dd/mm/aaaa; só exibida, nunca usada para ordenar
  sigiloso: boolean // nível de sigilo do documento > 0; nível desconhecido conta como true (ver documentoSigiloso em lib/sigilo.ts)
}

/**
 * A capa do processo, já sem CPF, CNPJ e OAB. Quem a produz passa todo campo de texto
 * por `minimizar` (lib/minimizacao.ts); `montarCaso` minimiza de novo, como última barreira.
 */
export type Capa = {
  numero: string // 20 dígitos
  classe: string
  orgao: string
  relator: string | null
  assuntos: string[]
  poloAtivo: string[]
  poloPassivo: string[]
}
