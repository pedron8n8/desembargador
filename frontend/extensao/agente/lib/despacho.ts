import { ErroEproc, type TipoErro } from './erros.ts'
import { lerEstado, type DocLike, type Estado } from './estado.ts'

// Protocolo painel -> agente. B, C e D acrescentam tipos aqui.
export type Pedido = { tipo: 'estado' }
export type Resposta = { ok: true; estado: Estado } | { ok: false; erro: TipoErro }

export async function responder(msg: unknown, doc: DocLike, url: string): Promise<Resposta | null> {
  if ((msg as Pedido | null)?.tipo !== 'estado') return null
  try {
    return { ok: true, estado: lerEstado(doc, url) }
  } catch (e) {
    // Erro conhecido passa adiante; qualquer outro é tela que mudou.
    return { ok: false, erro: e instanceof ErroEproc ? e.tipo : 'LAYOUT' }
  }
}
