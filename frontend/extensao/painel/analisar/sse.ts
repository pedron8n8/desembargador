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
      try {
        aoEvento({ id, tipo, dados: JSON.parse(dados.join('\n')) })
      } catch {
        /* data ilegível: ignora */
      }
    }
  }
}

/** Lê o corpo de uma resposta SSE até ele fechar, entregando cada evento. */
export async function lerStream(corpo: ReadableStream<Uint8Array>, aoEvento: (e: EventoSse) => void): Promise<void> {
  const ler = criarLeitorSse(aoEvento)
  const decodificador = new TextDecoder()
  const leitor = corpo.getReader()
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    ler(decodificador.decode(value, { stream: true }))
  }
}
