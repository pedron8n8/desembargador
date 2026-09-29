import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrirPainel, type Aba, type Deps } from './fluxo.ts'

const ESTADO = { logado: true, instancia: '1g', processo: '50012345620204047100' } as const
const aba = (id: number, extra: Partial<Aba> = {}): Aba => ({ id, ativa: false, descartada: false, ...extra })

function deps(extra: Partial<Deps> = {}) {
  const chamadas: string[] = []
  const d: Deps = {
    eu: async () => ({ email: 'adv@exemplo.com.br' }),
    abasEproc: async () => [aba(7)],
    recarregar: async (id) => { chamadas.push('recarregar ' + id) },
    enviar: async (id) => { chamadas.push('enviar ' + id); return { ok: true, estado: ESTADO } },
    ...extra,
  }
  return { d, chamadas }
}
const erroHttp = (status: number) => Object.assign(new Error('http'), { status })

test('caminho feliz', async () => {
  const { d } = deps()
  assert.deepEqual(await abrirPainel(d), { tipo: 'pronto', email: 'adv@exemplo.com.br', abaId: 7, estado: ESTADO })
})

test('401 da nossa API: sem login, e não olha o eproc', async () => {
  const { d, chamadas } = deps({ eu: async () => { throw erroHttp(401) } })
  assert.deepEqual(await abrirPainel(d), { tipo: 'sem_login' })
  assert.deepEqual(chamadas, [])
})

test('nossa API fora (500 ou rede): SISTEMA_FORA, não "entre no sistema"', async () => {
  for (const falha of [erroHttp(500), new TypeError('Failed to fetch')]) {
    const { d } = deps({ eu: async () => { throw falha } })
    assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'SISTEMA_FORA' })
  }
})

test('sem aba do eproc', async () => {
  const { d } = deps({ abasEproc: async () => [] })
  assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'SEM_ABA_EPROC' })
})

test('abasEproc lança erro: SEM_ABA_EPROC', async () => {
  const { d } = deps({ abasEproc: async () => { throw new Error('chrome.tabs.query failed') } })
  assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'SEM_ABA_EPROC' })
})

test('várias abas: prefere a ativa; descartada é recarregada antes', async () => {
  const { d, chamadas } = deps({ abasEproc: async () => [aba(1), aba(2, { ativa: true, descartada: true }), aba(3)] })
  const t = await abrirPainel(d)
  assert.equal(t.tipo === 'pronto' && t.abaId, 2)
  assert.deepEqual(chamadas, ['recarregar 2', 'enviar 2'])
})

test('nenhuma ativa: usa a primeira', async () => {
  const { d, chamadas } = deps({ abasEproc: async () => [aba(4), aba(5)] })
  await abrirPainel(d)
  assert.deepEqual(chamadas, ['enviar 4'])
})

test('agente diz não logado', async () => {
  const { d } = deps({ enviar: async () => ({ ok: true, estado: { logado: false, instancia: null, processo: null } }) })
  assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'NAO_LOGADO' })
})

test('agente devolve erro conhecido', async () => {
  const ERROS = ['NAO_LOGADO', 'CAPTCHA', 'LAYOUT', 'EPROC_FORA', 'SIGILOSO', 'SEM_ABA_EPROC'] as const
  for (const tipoErro of ERROS) {
    const { d } = deps({ enviar: async () => ({ ok: false, erro: tipoErro }) })
    assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: tipoErro }, tipoErro)
  }
})

test('resposta fora do formato (agente antigo, undefined, erro inventado): LAYOUT', async () => {
  for (const r of [undefined, null, 'x', { ok: true }, { ok: false, erro: 'INVENTADO' }, { ok: true, estado: { logado: 'sim' } },
    { ok: true, estado: { logado: true, instancia: 'x', processo: null } },
    { ok: true, estado: { logado: true, instancia: '1g', processo: '123' } },
    { ok: true, estado: { logado: true, instancia: null, processo: null } },
    { ok: true, estado: { logado: true, processo: null } }]) {
    const { d } = deps({ enviar: async () => r })
    assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'LAYOUT' }, JSON.stringify(r))
  }
})

test('aba some ou não responde mesmo após reinjeção: SEM_ABA_EPROC', async () => {
  const { d } = deps({ enviar: async () => { throw new Error('No tab with id: 7') } })
  assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'SEM_ABA_EPROC' })
})
