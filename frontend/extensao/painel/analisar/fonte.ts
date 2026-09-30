import type { Capa, Peca } from '../../agente/lib/caso.ts'

/** O que uma peça do processo devolve: já em texto (HTML lido na aba) ou um arquivo (PDF...) para o servidor extrair. */
export type DocumentoLido = { tipo: 'texto'; texto: string } | { tipo: 'arquivo'; nome: string; base64: string }

/**
 * O que o painel precisa do agente para analisar o processo aberto na aba.
 * É o contrato que as primitivas de rede da B (plano futuro, dependem do HAR do
 * TJSC) vão implementar; até lá o painel só conhece esta interface, e a página de
 * demonstração a implementa com dados fictícios. Tudo o que sai daqui já vem do
 * agente minimizado (CPF, CNPJ e OAB fora) e sem peça sigilosa.
 */
export type Fonte = {
  capa(): Promise<Capa>
  pecas(): Promise<Peca[]>
  documento(ref: string): Promise<DocumentoLido>
}
