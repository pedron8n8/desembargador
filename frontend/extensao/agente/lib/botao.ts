// O botão flutuante dentro da página do eproc: só abre o painel lateral da extensão.
// Não lê nada da página, e por ser `position: fixed` dentro de um shadow DOM não depende
// do layout do eproc (que pode mudar) nem recebe o CSS dele.

export const ID_BOTAO = 'segundo-cerebro-botao'

/** O pedaço da API do DOM que usamos; o `Document` real cabe aqui, e o teste usa um falso. */
export type ElementoMinimo = {
  id: string
  title: string
  textContent: string | null
  style: { cssText: string }
  append(...filhos: unknown[]): void
  attachShadow(init: { mode: 'open' | 'closed' }): { append(...filhos: unknown[]): void }
  addEventListener(tipo: string, f: () => void): void
}
export type DocMinimo = {
  createElement(tag: string): ElementoMinimo
  getElementById(id: string): unknown
  body: { append(el: unknown): void } | null
}

const CSS =
  'button{font:13px system-ui,sans-serif;padding:8px 12px;border:0;border-radius:2px;background:#2f4a3f;color:#faf8f4;cursor:pointer;opacity:.92}' +
  'button:hover{opacity:1}'

/**
 * O service worker só abre o painel a pedido dos NOSSOS content scripts: mesma extensão
 * (remetente.id) e vindo de uma aba. Devolve o tabId, ou null se o pedido não vale.
 */
export function abaDoPedidoDeAbrir(msg: unknown, remetente: { id?: string; tab?: { id?: number } }, idProprio: string): number | null {
  const tabId = remetente.tab?.id
  const tipo = (msg as { tipo?: unknown } | null)?.tipo
  return remetente.id === idProprio && tipo === 'abrir_painel' && tabId !== undefined ? tabId : null
}

/** Cria o botão uma única vez. Devolve false se já existia ou se a página ainda não tem corpo. */
export function montarBotao(doc: DocMinimo, aoClicar: () => void): boolean {
  if (!doc.body || doc.getElementById(ID_BOTAO)) return false
  const hospedeiro = doc.createElement('div')
  hospedeiro.id = ID_BOTAO
  hospedeiro.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647'
  const raiz = hospedeiro.attachShadow({ mode: 'closed' })
  const estilo = doc.createElement('style')
  estilo.textContent = CSS
  const botao = doc.createElement('button')
  botao.textContent = 'Segundo Cérebro'
  botao.title = 'Abrir o painel do Segundo Cérebro'
  botao.addEventListener('click', aoClicar)
  raiz.append(estilo, botao)
  doc.body.append(hospedeiro)
  return true
}
