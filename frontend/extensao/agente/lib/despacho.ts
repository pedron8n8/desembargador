import { ErroEproc, type TipoErro } from './erros.ts'
import { lerEstado, type DocLike, type Estado } from './estado.ts'
import { lerTexto, type LeitorDePagina, type TextoLido } from './texto.ts'

// Protocolo painel -> agente. B, C e D acrescentam tipos aqui.
export type Pedido = { tipo: 'estado' } | { tipo: 'texto' }
export type Resposta = { ok: true; estado: Estado } | ({ ok: true } & TextoLido) | { ok: false; erro: TipoErro }

/** Esta mensagem é para o agente? O listener usa isto para decidir se mantém o canal aberto; `responder`, para decidir se responde. */
export function ehPedido(msg: unknown): msg is Pedido {
  const tipo = (msg as { tipo?: unknown } | null)?.tipo
  return tipo === 'estado' || tipo === 'texto'
}

export async function responder(msg: unknown, doc: DocLike, url: string, leitor?: LeitorDePagina): Promise<Resposta | null> {
  if (!ehPedido(msg)) return null
  try {
    if (msg.tipo === 'texto') {
      if (!leitor) throw new ErroEproc('LAYOUT', 'agente sem leitor de página')
      return { ok: true, ...lerTexto(leitor) }
    }
    return { ok: true, estado: lerEstado(doc, url) }
  } catch (e) {
    // Erro conhecido passa adiante; qualquer outro é tela que mudou.
    return { ok: false, erro: e instanceof ErroEproc ? e.tipo : 'LAYOUT' }
  }
}
