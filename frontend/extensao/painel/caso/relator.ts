// Nome de pessoa sem acento, sem caixa, sem título e com espaço normalizado. Só
// serve para COMPARAR; nunca para exibir.
const TITULO = /^(desembargador(a)?|des\.?|ju[ií]z(a)?( federal)?|dr\.?|dra\.?)\s+/i

export function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ') // antes do título: o ^ do TITULO precisa do começo limpo
    .trim()
    .replace(TITULO, '')
    .toLowerCase()
}

/**
 * Qual cérebro (acervo de um desembargador) corresponde ao relator do processo.
 * Igualdade EXATA do nome normalizado, e nada de "parecido": escolher o acervo
 * errado é o único erro daqui que ninguém percebe olhando a tela. Sem
 * correspondência devolve null, e o painel avisa em vez de escolher.
 */
export function cerebroDoRelator(relator: string | null, cerebros: { slug: string; nome: string }[]): string | null {
  if (!relator) return null
  const alvo = normalizarNome(relator)
  if (!alvo) return null
  const achados = cerebros.filter((c) => normalizarNome(c.nome) === alvo)
  return achados.length === 1 ? achados[0].slug : null
}
