// Ações do eproc que o agente NUNCA pode disparar, nem por engano de quem usar a rede.
// A razão de existir: abrir uma intimação registra ciência e começa a contar prazo.
//
// A lista está VAZIA de propósito até o HAR do TJSC mostrar o nome exato da ação que
// registra ciência (o parâmetro `acao` da URL do controlador, ou `acao_ajax`): chutar
// nomes daria falsa segurança. O mecanismo já vale desde agora e é testado com uma
// lista injetada; quando o nome aparecer, é só acrescentá-lo aqui.
export const ACOES_PROIBIDAS: readonly string[] = []

/** O nome da ação proibida que a URL dispara, ou null se nenhuma. Sem distinguir maiúsculas. */
export function acaoProibida(url: string, proibidas: readonly string[] = ACOES_PROIBIDAS): string | null {
  let u: URL
  try {
    u = new URL(url, 'https://eproc.invalido/')
  } catch {
    return null // URL ilegível: o fetch também vai falhar
  }
  const lista = proibidas.map((a) => a.toLowerCase())
  const pedidas = [u.searchParams.get('acao'), u.searchParams.get('acao_ajax')]
  for (const a of pedidas) if (a && lista.includes(a.toLowerCase())) return a
  return null
}
