// Ações do eproc que o agente NUNCA pode disparar, nem por engano de quem usar a rede.
// A razão de existir: abrir uma intimação registra ciência e começa a contar prazo.
//
// A lista está VAZIA de propósito até o HAR do TJSC mostrar o nome exato da ação que
// registra ciência (o parâmetro `acao` da URL do controlador, ou `acao_ajax`): chutar
// nomes daria falsa segurança. O mecanismo já vale desde agora e é testado com uma
// lista injetada; quando o nome aparecer, é só acrescentá-lo aqui.
// LIMITE: um redirecionamento para ação proibida só é detectado DEPOIS da requisição intermediária; o fechamento total depende do HAR.
export const ACOES_PROIBIDAS: readonly string[] = []

const CHAVES = ['acao', 'acao_ajax']

function primeiraProibida(valores: string[], proibidas: readonly string[]): string | null {
  const lista = proibidas.map((a) => a.toLowerCase())
  for (const a of valores) if (a && lista.includes(a.toLowerCase())) return a
  return null
}

/**
 * O nome da ação proibida que a URL dispara, ou null se nenhuma. Sem distinguir maiúsculas.
 * Olha TODOS os valores repetidos (o PHP usa o último, então o primeiro não basta).
 */
export function acaoProibida(url: string, proibidas: readonly string[] = ACOES_PROIBIDAS): string | null {
  let u: URL
  try {
    u = new URL(url, 'https://eproc.invalido/')
  } catch {
    return null // URL ilegível: o fetch também vai falhar
  }
  return primeiraProibida(CHAVES.flatMap((k) => u.searchParams.getAll(k)), proibidas)
}

/** Idem para os pares do corpo de um POST (chaves `acao` e `acao_ajax`, todos os valores). */
export function acaoProibidaNosPares(pares: readonly [string, string][], proibidas: readonly string[] = ACOES_PROIBIDAS): string | null {
  return primeiraProibida(pares.filter(([k]) => CHAVES.includes(k.toLowerCase())).map(([, v]) => v), proibidas)
}
