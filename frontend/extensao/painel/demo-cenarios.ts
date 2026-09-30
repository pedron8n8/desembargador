// Cenários da página de demonstração (demo.html): o painel de verdade, com um
// eproc de mentira. Tudo aqui é FICTÍCIO — o número de processo é o do guia
// técnico — e nada toca o eproc nem a nossa API.
import type { Estado } from '../agente/lib/estado.ts'
import type { Deps, Tela } from './fluxo.ts'

const EMAIL = 'advogado@escritorio.com'
const PROCESSO = '50012345620208240023'

export type Cenario = { id: string; nome: string; deps: Deps; esperado: Tela }

const http = (status: number) => Object.assign(new Error('http ' + status), { status })

function montar(pausaMs: number, op: { eu?: () => Promise<{ email: string }>; semAba?: boolean; resposta?: unknown }): Deps {
  const pausa = () => new Promise<void>((r) => setTimeout(r, pausaMs))
  return {
    eu: async () => { await pausa(); return op.eu ? op.eu() : { email: EMAIL } },
    abasEproc: async () => (op.semAba ? [] : [{ id: 7, ativa: true, descartada: false }]),
    recarregar: async () => {},
    enviar: async () => op.resposta,
  }
}

export function cenarios(pausaMs = 400): Cenario[] {
  const pronto = (id: string, nome: string, estado: Estado): Cenario => ({
    id, nome,
    deps: montar(pausaMs, { resposta: { ok: true, estado } }),
    esperado: { tipo: 'pronto', email: EMAIL, abaId: 7, estado },
  })
  const erro = (id: string, nome: string, e: Extract<Tela, { tipo: 'erro' }>['erro'], op: Parameters<typeof montar>[1]): Cenario => ({
    id, nome, deps: montar(pausaMs, op), esperado: { tipo: 'erro', erro: e },
  })
  const doAgente = (e: string) => ({ resposta: { ok: false, erro: e } })
  return [
    pronto('1g', 'Processo aberto · 1º grau', { logado: true, instancia: '1g', processo: PROCESSO }),
    pronto('2g', 'Processo aberto · 2º grau', { logado: true, instancia: '2g', processo: PROCESSO }),
    pronto('sem-processo', 'Logado, fora de um processo', { logado: true, instancia: '1g', processo: null }),
    erro('sem-aba', 'Sem aba do eproc aberta', 'SEM_ABA_EPROC', { semAba: true }),
    erro('nao-logado', 'Sessão do eproc caiu', 'NAO_LOGADO', { resposta: { ok: true, estado: { logado: false, instancia: null, processo: null } } }),
    erro('captcha', 'eproc pediu verificação (captcha)', 'CAPTCHA', doAgente('CAPTCHA')),
    erro('sigiloso', 'Processo em sigilo', 'SIGILOSO', doAgente('SIGILOSO')),
    erro('layout', 'Tela do eproc mudou', 'LAYOUT', doAgente('LAYOUT')),
    erro('eproc-fora', 'eproc fora do ar', 'EPROC_FORA', doAgente('EPROC_FORA')),
    erro('sistema-fora', 'Nosso sistema fora do ar', 'SISTEMA_FORA', { eu: async () => { throw http(500) } }),
    { id: 'sem-login', nome: 'Sem login no nosso sistema', deps: montar(pausaMs, { eu: async () => { throw http(401) } }), esperado: { tipo: 'sem_login' } },
  ]
}
