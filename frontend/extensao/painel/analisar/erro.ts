import { ErroEproc } from '../../agente/lib/erros.ts'
import { MENSAGENS } from '../mensagens.ts'

/**
 * O texto que o usuário vê quando algo falha. Erro do agente (ErroEproc) sai da tabela
 * de mensagens do painel, escolhido pelo `tipo`: o `message` dele carrega detalhe
 * técnico (seletor, redirecionamento) que não é para a tela. Os outros erros (do nosso
 * servidor, do corpo da consulta) já têm mensagem escrita para o usuário.
 */
export function mensagemDoErro(e: unknown): string {
  if (e instanceof ErroEproc) return MENSAGENS[e.tipo].texto
  return e instanceof Error && e.message ? e.message : 'Algo deu errado.'
}
