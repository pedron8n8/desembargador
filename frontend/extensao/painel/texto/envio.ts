import type { FonteDoTexto } from './fonteTexto.ts'

/**
 * Pode enviar o texto ao servidor (buscar, analisar)? Sem seleção o texto é a página
 * inteira e não sabemos detectar segredo de justiça: o advogado precisa confirmar. Com
 * seleção, o advogado escolheu o trecho e a confirmação não é exigida.
 */
export function podeEnviar(p: { fonte: FonteDoTexto; confirmou: boolean; texto: string }): boolean {
  if (!p.texto.trim()) return false
  return p.fonte === 'selecao' || p.confirmou
}

export const ROTULO_SIGILO = 'Confirmo que este processo não está em segredo de justiça'

/** A origem (rótulo do processo) só vai na consulta quando o advogado selecionou o trecho: o rótulo da aba pode não ser o do texto da página. */
export function origemDoTexto<T>(fonte: FonteDoTexto, origem: T | undefined): T | undefined {
  return fonte === 'selecao' ? origem : undefined
}
