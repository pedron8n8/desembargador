// OBRIGAÇÃO da leitura real: para item sigiloso o agente deve devolver só a contagem, nunca processo/classe/evento
/** Um item do painel do advogado do eproc (uma intimação ou um prazo pendente). */
export type ItemPainel = {
  ref: string // referência opaca; o link assinado do processo fica só no agente
  processo: string // 20 dígitos
  classe: string
  tipo: 'intimacao' | 'prazo' | 'outro'
  inicio: string // dd/mm/aaaa, como o eproc mostra
  prazoFinal: string | null // dd/mm/aaaa, como o eproc mostra; null se o item não tem prazo
  evento: string // descrição curta do evento
  sigiloso: boolean // processo em sigilo: o painel só conta, nunca mostra
}

/**
 * O que o painel precisa do agente para mostrar as intimações e os prazos do advogado.
 * É o contrato que a leitura real da tela `painel_adv_listar` vai implementar (depende
 * do HAR do TJSC); até lá, a página de demonstração o implementa com dados fictícios.
 *
 * REGRA INEGOCIÁVEL: a implementação só LÊ a listagem. Abrir ou marcar uma intimação
 * pode registrar ciência e começa a contar prazo: nunca. Por isso `abrir` abre o
 * PROCESSO numa aba nova (com o link que o agente guardou), nunca a intimação, e a
 * rede do agente tem uma lista de ações proibidas (`agente/lib/proibidas.ts`).
 */
export type FonteAdvogado = {
  painel(): Promise<ItemPainel[]>
  abrir(ref: string): Promise<void>
}
