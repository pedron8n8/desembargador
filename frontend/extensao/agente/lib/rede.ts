import { ErroEproc } from './erros.ts'
import { acaoProibida, acaoProibidaNosPares } from './proibidas.ts'

// O controlador_ajax declara iso-8859-1 até em JSON; response.text() assumiria
// UTF-8 e estragaria acento cru. Estrito primeiro, porque UTF-8 válido quase
// nunca é latin1 por acaso.
export function decodificar(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

const PARECE_LOGIN = /type=["']?password|pwdSenha/i
const URL_LOGIN = /\/(index|externo_controlador)\.php/

type Opcoes = {
  base: string
  fetch?: typeof fetch
  intervaloMs?: number
  esperar?: (ms: number) => Promise<void>
  agora?: () => number
  /** Ações que esta rede nunca dispara (ver proibidas.ts). Padrão: ACOES_PROIBIDAS. */
  proibidas?: readonly string[]
}

export function criarRede(op: Opcoes) {
  const buscar = op.fetch ?? fetch.bind(globalThis)
  const intervalo = op.intervaloMs ?? 1000
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const agora = op.agora ?? Date.now
  // ponytail: fila global por aba. Se B/C precisarem de paralelismo, não precisam:
  // o eproc é de um humano, e ritmo humano é a defesa contra captcha e bloqueio.
  let fila: Promise<unknown> = Promise.resolve()
  let ultimaSaida = -Infinity

  function naFila<T>(tarefa: () => Promise<T>): Promise<T> {
    const vez = fila.then(async () => {
      const falta = ultimaSaida + intervalo - agora()
      if (falta > 0) await esperar(falta)
      try {
        return await tarefa()
      } finally {
        ultimaSaida = agora()
      }
    })
    fila = vez.catch(() => {})
    return vez
  }

  // Recusa ANTES de entrar na fila: não gasta o intervalo e nem toca o eproc.
  function recusar(url: string, pares: [string, string][] = []): Promise<never> | null {
    const a = acaoProibida(url, op.proibidas) ?? acaoProibidaNosPares(pares, op.proibidas)
    return a ? Promise.reject(new ErroEproc('LAYOUT', 'ação proibida: ' + a)) : null
  }

  async function requisitar(url: string, init: RequestInit): Promise<string> {
    let r: Response
    try {
      r = await buscar(new URL(url, op.base).href, {
        ...init,
        credentials: 'same-origin',
        signal: AbortSignal.timeout(25000),
      })
    } catch (e) {
      throw new ErroEproc('EPROC_FORA', String(e))
    }
    // Limite: a requisição intermediária já aconteceu; o fechamento total depende do HAR.
    // Aqui só impedimos que o corpo de uma ação proibida chegue a quem chamou.
    if (r.redirected) {
      const a = acaoProibida(r.url, op.proibidas)
      if (a) throw new ErroEproc('LAYOUT', 'ação proibida: ' + a)
    }
    if (r.status === 401 || r.status === 403) throw new ErroEproc('NAO_LOGADO', 'status ' + r.status)
    if (!r.ok) throw new ErroEproc('EPROC_FORA', 'status ' + r.status)
    if (r.redirected && URL_LOGIN.test(new URL(r.url).pathname)) throw new ErroEproc('NAO_LOGADO', 'redirecionado')
    let texto: string
    try {
      texto = decodificar(await r.arrayBuffer())
    } catch (e) {
      throw new ErroEproc('EPROC_FORA', String(e))
    }
    if (PARECE_LOGIN.test(texto.slice(0, 20000))) throw new ErroEproc('NAO_LOGADO', 'tela de login')
    return texto
  }

  return {
    postar(url: string, pares: [string, string][]): Promise<unknown> {
      const barrada = recusar(url, pares)
      if (barrada) return barrada
      return naFila(async () => {
        const texto = await requisitar(url, {
          method: 'POST',
          body: new URLSearchParams(pares), // lista de pares: aceita fnValidacao[] repetido
          headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' },
        })
        try {
          return JSON.parse(texto)
        } catch {
          throw new ErroEproc('LAYOUT', 'resposta não é JSON')
        }
      })
    },
    // Contrato: garante apenas "não é uma tela de login óbvia" (detecta via campo
    // de senha ou redirecionamento). Cada chamador DEVE validar que a página contém
    // os elementos esperados; nunca retorna resultado vazio.
    baixarPagina(url: string): Promise<string> {
      const barrada = recusar(url)
      if (barrada) return barrada
      return naFila(() => requisitar(url, { method: 'GET' }))
    },
  }
}
