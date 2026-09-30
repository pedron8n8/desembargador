import { ErroEproc, type TipoErro } from '../../agente/lib/erros.ts'
import type { TextoLido } from '../../agente/lib/texto.ts'

export type { TextoLido }

const ERROS: Record<TipoErro, true> = {
  NAO_LOGADO: true, CAPTCHA: true, LAYOUT: true, EPROC_FORA: true, SIGILOSO: true, SEM_ABA_EPROC: true,
}

/**
 * Valida a resposta do agente ao pedido de texto. Uma resposta fora do formato (agente
 * antigo, versão diferente) é LAYOUT: nunca vira "texto vazio", que pareceria uma página sem nada.
 */
export function lerRespostaTexto(r: unknown): TextoLido {
  const x = r as { ok?: unknown; erro?: unknown; texto?: unknown; fonte?: unknown; cortado?: unknown } | null
  if (x?.ok === false && typeof x.erro === 'string' && Object.hasOwn(ERROS, x.erro)) throw new ErroEproc(x.erro as TipoErro)
  if (x?.ok === true && typeof x.texto === 'string' && (x.fonte === 'selecao' || x.fonte === 'pagina') && typeof x.cortado === 'boolean') {
    return { texto: x.texto, fonte: x.fonte, cortado: x.cortado }
  }
  throw new ErroEproc('LAYOUT', 'resposta de texto fora do formato')
}
