import type { TipoErro } from '../agente/lib/erros.ts'
import type { Estado } from '../agente/lib/estado.ts'

export type ErroPainel = TipoErro | 'SISTEMA_FORA'
export type Aba = { id: number; ativa: boolean; descartada: boolean }
export type Deps = {
  eu(): Promise<{ email: string }>
  abasEproc(): Promise<Aba[]>
  recarregar(id: number): Promise<void>
  enviar(id: number, msg: { tipo: 'estado' }): Promise<unknown>
}
export type Tela =
  | { tipo: 'sem_login' }
  | { tipo: 'erro'; erro: ErroPainel }
  | { tipo: 'pronto'; email: string; abaId: number; estado: Estado }

const ERROS_DO_AGENTE: readonly string[] = ['NAO_LOGADO', 'CAPTCHA', 'LAYOUT', 'EPROC_FORA', 'SIGILOSO', 'SEM_ABA_EPROC']
const erro = (e: ErroPainel): Tela => ({ tipo: 'erro', erro: e })

function estadoValido(x: unknown): x is Estado {
  const e = x as Estado | null
  return !!e && typeof e.logado === 'boolean'
}

export async function abrirPainel(d: Deps): Promise<Tela> {
  let email: string
  try {
    email = (await d.eu()).email
  } catch (e) {
    // Só 401 é "entre no sistema". Servidor fora não é falta de login, e dizer
    // que é mandaria o advogado para uma tela de login que também não abre.
    return (e as { status?: number }).status === 401 ? { tipo: 'sem_login' } : erro('SISTEMA_FORA')
  }

  const abas = await d.abasEproc()
  const aba = abas.find((a) => a.ativa) ?? abas[0]
  if (!aba) return erro('SEM_ABA_EPROC')

  let r: unknown
  try {
    if (aba.descartada) await d.recarregar(aba.id)
    r = await d.enviar(aba.id, { tipo: 'estado' })
  } catch {
    return erro('SEM_ABA_EPROC') // aba fechada no meio, ou sem resposta mesmo reinjetando
  }

  const resp = r as { ok?: unknown; erro?: unknown; estado?: unknown } | null
  if (resp?.ok === false && typeof resp.erro === 'string' && ERROS_DO_AGENTE.includes(resp.erro)) return erro(resp.erro as TipoErro)
  if (resp?.ok !== true || !estadoValido(resp.estado)) return erro('LAYOUT')
  if (!resp.estado.logado) return erro('NAO_LOGADO')
  return { tipo: 'pronto', email, abaId: aba.id, estado: resp.estado }
}
