import { minimizar } from './minimizacao.ts'

/** De onde veio o texto: o que o advogado selecionou na tela, ou a página inteira. */
export type FonteDoTexto = 'selecao' | 'pagina'
export type TextoLido = { texto: string; fonte: FonteDoTexto; cortado: boolean }

/** O que o agente consegue ler da página. Interface mínima, para testar sem navegador. */
export type LeitorDePagina = { selecao(): string; pagina(): string }

/** Teto do texto que o agente devolve ao painel (o servidor ainda recusa acima de 120.000). */
export const TETO_TEXTO = 100_000

/**
 * O texto da tela do eproc: o trecho que o advogado SELECIONOU, se houver; senão o
 * texto da página. Sai minimizado (CPF, CNPJ e OAB fora) e depois cortado no teto; nessa
 * ordem, para um corte nunca deixar pela metade um número que a minimização não
 * reconheceria mais. `cortado` avisa o painel de que o fim ficou de fora.
 *
 * Não sabemos se a página é de um processo em sigilo (a tela é do eproc; só o HAR do
 * TJSC mostrará onde ele avisa isso): quem decide enviar é o advogado, e a tela do
 * painel avisa para não enviar conteúdo sigiloso.
 *
 * OBRIGAÇÃO da leitura real (HAR): detectar o marcador de sigilo da tela e devolver
 * ErroEproc SIGILOSO. Até lá, sem seleção o painel exige a confirmação do advogado
 * (painel/texto/envio.ts).
 */
export function lerTexto(leitor: LeitorDePagina, teto = TETO_TEXTO): TextoLido {
  const selecionado = leitor.selecao().trim()
  const fonte: FonteDoTexto = selecionado ? 'selecao' : 'pagina'
  const limpo = minimizar(selecionado || leitor.pagina().trim()).trim()
  return limpo.length > teto ? { texto: limpo.slice(0, teto), fonte, cortado: true } : { texto: limpo, fonte, cortado: false }
}
