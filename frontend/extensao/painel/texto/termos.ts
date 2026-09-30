// A busca de precedentes do servidor (GET /api/corpus?q=) quebra `q` em termos por ";"
// ou quebra de linha, e cada termo vira uma FRASE literal entre aspas (src/rag/busca.py,
// `_termo_fts`). Um parágrafo colado inteiro seria uma frase só, que nenhuma decisão
// repete. Por isso o painel converte o texto em PALAVRAS de conteúdo, uma por termo: o
// servidor as junta com OR e o BM25 ordena por quantas casam.

const VAZIAS = new Set(
  ('sobre entre porque quando contra ainda também assim sendo essa esse essas esses esta este estas estes aquela aquele ' +
    'quais qual seus suas mesmo mesma mesmos mesmas pelos pelas desde apenas pode podem deve devem foram sido será serão ' +
    'deste desta destes destas nesse nessa nesses nessas neste nesta nestes nestas após perante conforme diante todos todas ' +
    'outro outra outros outras tendo havendo estão estava estavam existe existem onde cujo cuja cujos cujas aqui dessa dessas ' +
    'desse desses mediante através segundo conforme portanto entretanto contudo porém todavia logo então pois senão como ' +
    'recurso apelação processo autos autor autora requerente requerido parte partes decisão sentença acórdão artigo').split(' '),
)

/**
 * Até `max` palavras de conteúdo do texto (5 letras ou mais, fora as comuns), as mais
 * frequentes primeiro e, no empate, as mais longas e depois a ordem alfabética (resultado
 * sempre igual para o mesmo texto), separadas por ";". Texto sem palavras úteis dá "".
 */
export function termosDeBusca(texto: string, max = 12): string {
  const contagem = new Map<string, number>()
  for (const p of texto.toLowerCase().match(/\p{L}{5,}/gu) ?? []) {
    if (!VAZIAS.has(p)) contagem.set(p, (contagem.get(p) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([p]) => p)
    .join(';')
}
