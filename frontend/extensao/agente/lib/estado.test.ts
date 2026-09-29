import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerEstado, type DocLike } from './estado.ts'

// Documento falso: só os seletores que lerEstado consulta. Os valores vêm do
// HTML gravado da JFRS (btn-encerrar-sessao, body.instancia-1g).
const doc = (op: { sair?: boolean; senha?: boolean; classe?: string }): DocLike => ({
  body: { className: op.classe ?? 'bootstrap-styles instancia-1g' },
  querySelector: (sel: string) =>
    (sel === '#btn-encerrar-sessao' && op.sair) || (sel === 'input[type="password"]' && op.senha) ? {} : null,
})
const DETALHE = 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=processo_selecionar&acao_origem=x&num_processo=50012345620204047100&hash=abc'
const CONSULTA = 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=processo_consultar&hash=abc'

test('logado, num detalhe de processo', () => {
  assert.deepEqual(lerEstado(doc({ sair: true }), DETALHE), { logado: true, instancia: '1g', processo: '50012345620204047100' })
})

test('logado, fora de processo', () => {
  assert.deepEqual(lerEstado(doc({ sair: true }), CONSULTA), { logado: true, instancia: '1g', processo: null })
})

test('tela de login', () => {
  assert.deepEqual(lerEstado(doc({ senha: true, classe: '' }), 'https://eproc1g.tjsc.jus.br/eproc/index.php'), { logado: false, instancia: null, processo: null })
})

test('botão sair e campo de senha juntos: não logado (fail closed)', () => {
  assert.equal(lerEstado(doc({ sair: true, senha: true }), CONSULTA).logado, false)
})

test('instância: classe do body; sem classe, pelo host', () => {
  assert.equal(lerEstado(doc({ sair: true, classe: 'instancia-2g' }), CONSULTA).instancia, '2g')
  assert.equal(lerEstado(doc({ sair: true, classe: '' }), 'https://eproc2g.tjsc.jus.br/eproc/controlador.php?acao=x').instancia, '2g')
  assert.equal(lerEstado(doc({ sair: true, classe: '' }), CONSULTA).instancia, '1g')
})

test('num_processo inválido ou em outra ação não é processo aberto', () => {
  const u = (q: string) => 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?' + q
  assert.equal(lerEstado(doc({ sair: true }), u('acao=processo_selecionar&num_processo=123')).processo, null)
  assert.equal(lerEstado(doc({ sair: true }), u('acao=outra&num_processo=50012345620204047100')).processo, null)
})
