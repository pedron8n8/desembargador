import type { Capa, Peca } from '../../agente/lib/caso.ts'

/** O que uma peça do processo devolve: já em texto (HTML lido na aba) ou um arquivo (PDF...) para o servidor extrair. */
export type DocumentoLido = { tipo: 'texto'; texto: string } | { tipo: 'arquivo'; nome: string; base64: string }

/**
 * O que o painel precisa do agente para analisar o processo aberto na aba.
 * É o contrato que as primitivas de rede da B (plano futuro, dependem do HAR do
 * TJSC) vão implementar; até lá o painel só conhece esta interface, e a página de
 * demonstração a implementa com dados fictícios. O que sai como TEXTO já vem do
 * agente minimizado (CPF, CNPJ e OAB fora) e sem peça sigilosa. Documentos que
 * vêm como ARQUIVO (`tipo: 'arquivo'`) seguem SEM minimização (bytes em base64)
 * para o `/api/extrair`, e o servidor pode passar PDF escaneado por OCR de
 * terceiros; só o texto extraído é minimizado depois, em `montarCaso`. A política
 * para documento em arquivo é decisão do plano futuro da ligação real.
 */
export type Fonte = {
  capa(): Promise<Capa>
  pecas(): Promise<Peca[]>
  documento(ref: string): Promise<DocumentoLido>
}
