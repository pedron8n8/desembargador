// Leitura de `text/event-stream` (o formato do GET /api/consultas/{thread}/eventos).
// O painel é uma página chrome-extension://, e o EventSource nativo não manda o
// cookie de sessão de forma confiável entre origens; por isso o stream é lido
// com fetch + ReadableStream e este parser, que é puro e testável.

export type EventoSse = { id: number; tipo: string; dados: unknown }

/**
 * Devolve uma função que recebe pedaços de texto (na ordem em que chegam, cortados
 * em qualquer ponto) e chama `aoEvento` a cada evento completo. Comentários
 * (`: ping`) e blocos sem `event:` são ignorados; `data:` ilegível (JSON inválido)
 * também: o servidor sempre manda JSON, então isso só pode ser lixo no meio do caminho.
 */
export function criarLeitorSse(aoEvento: (e: EventoSse) => void): (pedaco: string) => void {
  let resto = ''
  return (pedaco) => {
    resto += pedaco.replace(/\r\n?/g, '\n')
    let fim: number
    while ((fim = resto.indexOf('\n\n')) >= 0) {
      const bloco = resto.slice(0, fim)
      resto = resto.slice(fim + 2)
      let id = 0
      let tipo = ''
      const dados: string[] = []
      for (const linha of bloco.split('\n')) {
        if (linha.startsWith(':')) continue
        const i = linha.indexOf(':')
        const campo = i < 0 ? linha : linha.slice(0, i)
        const valor = i < 0 ? '' : linha.slice(i + 1).replace(/^ /, '')
        if (campo === 'id') id = Number(valor) || 0
        else if (campo === 'event') tipo = valor
        else if (campo === 'data') dados.push(valor)
      }
      if (!tipo) continue
      let lido: unknown
      try {
        lido = JSON.parse(dados.join('\n'))
      } catch {
        continue // data ilegível: ignora
      }
      aoEvento({ id, tipo, dados: lido }) // fora do try: bug do consumidor não é engolido
    }
  }
}

/**
 * Lê o corpo de uma resposta SSE, entregando cada evento, até ele fechar ou até o
 * primeiro evento terminal (`fim` ou `erro`). O servidor reenvia o terminal de uma
 * consulta que já acabou e mantém a conexão aberta com pings; por isso não dá para
 * esperar que ele feche. Nada que venha depois do terminal é entregue.
 */
export async function lerStream(corpo: ReadableStream<Uint8Array>, aoEvento: (e: EventoSse) => void): Promise<void> {
  let terminou = false
  const ler = criarLeitorSse((e) => {
    if (terminou) return
    aoEvento(e)
    if (e.tipo === 'fim' || e.tipo === 'erro') terminou = true
  })
  const decodificador = new TextDecoder()
  const leitor = corpo.getReader()
  try {
    while (!terminou) {
      const { done, value } = await leitor.read()
      if (done) break
      ler(decodificador.decode(value, { stream: true }))
    }
  } finally {
    // cancel() é o que avisa o servidor para largar a conexão
    try { await leitor.cancel() } catch { /* já fechado */ }
    try { leitor.releaseLock() } catch { /* já solto */ }
  }
}
