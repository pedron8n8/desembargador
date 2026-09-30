import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErroEproc } from '../../agente/lib/erros.ts'
import type { Peca } from '../../agente/lib/caso.ts'
import type { DocumentoLido } from './fonte.ts'
import { lerPecas } from './ler.ts'

const peca = (evento: number): Peca => ({ ref: `r${evento}`, tipo: 'X', rotulo: `PEÇA ${evento}`, evento, data: '01/01/2025', sigiloso: false })
const escolhidas = [1, 2, 3].map((n) => ({ papel: 'decisao' as const, peca: peca(n) }))
const api = { extrair: async (nome: string, base64: string) => `extraído de ${nome}:${base64}` }
const fonteDe = (f: (ref: string) => Promise<DocumentoLido>) => ({ documento: f })

test('texto direto e arquivo (extraído pelo servidor) entram na ordem recebida', async () => {
  const fonte = fonteDe(async (ref) => (ref === 'r2' ? { tipo: 'arquivo', nome: 'recurso.pdf', base64: 'QUJD' } : { tipo: 'texto', texto: `texto ${ref}` }))
  const { itens, falhas } = await lerPecas(fonte, api, escolhidas)
  assert.deepEqual(itens.map((i) => i.texto), ['texto r1', 'extraído de recurso.pdf:QUJD', 'texto r3'])
  assert.deepEqual(falhas, [])
})

test('uma peça que falha sai do texto com o motivo e não derruba as outras', async () => {
  const fonte = fonteDe(async (ref) => {
    if (ref === 'r1') throw new ErroEproc('SIGILOSO')
    if (ref === 'r2') throw new ErroEproc('LAYOUT', 'seletor x')
    return { tipo: 'texto', texto: 'ok' }
  })
  const { itens, falhas } = await lerPecas(fonte, api, escolhidas)
  assert.deepEqual(itens.map((i) => i.peca.ref), ['r3'])
  assert.deepEqual(falhas, [{ rotulo: 'PEÇA 1', motivo: 'em sigilo' }, { rotulo: 'PEÇA 2', motivo: 'o eproc não devolveu a peça' }])
})

test('erro do servidor na extração do arquivo vira motivo legível', async () => {
  const fonte = fonteDe(async () => ({ tipo: 'arquivo', nome: 'peca.rtf', base64: 'x' }))
  const apiRuim = { extrair: async () => { throw new Error('RTF ainda não é lido aqui') } }
  const { itens, falhas } = await lerPecas(fonte, apiRuim, [escolhidas[0]])
  assert.deepEqual(itens, [])
  assert.deepEqual(falhas, [{ rotulo: 'PEÇA 1', motivo: 'RTF ainda não é lido aqui' }])
})

test('peça sem texto (só espaços) vira falha, não item vazio', async () => {
  const fonte = fonteDe(async () => ({ tipo: 'texto', texto: '  \n ' }))
  const { itens, falhas } = await lerPecas(fonte, api, [escolhidas[0]])
  assert.deepEqual([itens.length, falhas.length], [0, 1])
})

test('sessão caída e captcha derrubam a montagem inteira (continuar não adianta)', async () => {
  for (const tipo of ['NAO_LOGADO', 'CAPTCHA'] as const) {
    const fonte = fonteDe(async () => { throw new ErroEproc(tipo) })
    await assert.rejects(lerPecas(fonte, api, escolhidas), (e) => e instanceof ErroEproc && e.tipo === tipo)
  }
})

test('nenhuma peça marcada: resultado vazio, sem chamar a fonte', async () => {
  let chamou = false
  const fonte = fonteDe(async () => { chamou = true; return { tipo: 'texto', texto: 'x' } })
  assert.deepEqual(await lerPecas(fonte, api, []), { itens: [], falhas: [] })
  assert.equal(chamou, false)
})
