import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captchaLiberado, exigirCaptchaLiberado } from './captcha.ts'
import { ErroEproc } from './erros.ts'
import { documentoSigiloso, exigirPublico, itemSigiloso, nivelDoTitulo, separar } from './sigilo.ts'

const LIBERADO = { captcha: { estado: 'ativo', validade: 'valido', codigo_estado: 1, codigo_validade: 1, captcha_imagem: 'false' } }
const com = (mudanca: object) => ({ captcha: { ...LIBERADO.captcha, ...mudanca } })

test('captcha: só passa sem desafio visual e com validade 1', () => {
  assert.equal(captchaLiberado(LIBERADO), true)
  assert.equal(captchaLiberado(com({ codigo_validade: '1' })), true) // número em string também vale
  for (const r of [com({ captcha_imagem: 'true' }), com({ captcha_imagem: false }), com({ codigo_validade: 2 }), { captcha: {} }, {}, null, 'x']) {
    assert.equal(captchaLiberado(r), false, JSON.stringify(r))
  }
})

test('captcha: exigir lança CAPTCHA', () => {
  assert.doesNotThrow(() => exigirCaptchaLiberado(LIBERADO))
  assert.throws(() => exigirCaptchaLiberado(com({ captcha_imagem: 'true' })), (e) => e instanceof ErroEproc && e.tipo === 'CAPTCHA')
})

test('sigilo de item de lista: só "0" é público; ausente conta como sigiloso', () => {
  assert.equal(itemSigiloso({ id_sigilo: '0' }), false)
  assert.equal(itemSigiloso({ id_sigilo: 0 }), false)
  assert.equal(itemSigiloso({ id_sigilo: '1' }), true)
  assert.equal(itemSigiloso({}), true)
})

test('sigilo de documento pelo title', () => {
  const t = (n: string) => 'DESPACHO/DECISÃO 1\nSem Sigilo (Nível ' + n + ')\n31.87KB'
  assert.equal(nivelDoTitulo(t('0')), 0)
  assert.equal(nivelDoTitulo(t('2')), 2)
  assert.equal(nivelDoTitulo('NIVEL 3'), 3)
  assert.equal(nivelDoTitulo('sem informação'), null)
  assert.equal(nivelDoTitulo('Sem Sigilo (Nível 0) ... Nível 2'), 2) // múltiplos níveis → máximo
  assert.equal(nivelDoTitulo('Nível 10'), 10)
  assert.equal(documentoSigiloso(t('0')), false)
  assert.equal(documentoSigiloso(t('1')), true)
  assert.equal(documentoSigiloso('Sem Sigilo (Nível 0) ... Nível 2'), true) // máximo > 0
  assert.equal(documentoSigiloso('sem informação'), true) // na dúvida, não sai
  assert.equal(documentoSigiloso(null), true)
})

test('separar: públicos na ordem original, sigilosos só contados', () => {
  const r = separar([{ id_sigilo: '0', n: 'a' }, { id_sigilo: '1', n: 'b' }, { id_sigilo: '0', n: 'c' }])
  assert.deepEqual(r.publicos.map((x) => x.n), ['a', 'c'])
  assert.equal(r.sigilosos, 1)
  assert.deepEqual(separar([]), { publicos: [], sigilosos: 0 })
  const rNull = separar([null as never, { id_sigilo: '0', n: 'x' }])
  assert.equal(rNull.publicos.length, 1)
  assert.equal(rNull.sigilosos, 1)
})

test('exigirPublico lança SIGILOSO', () => {
  assert.doesNotThrow(() => exigirPublico({ id_sigilo: '0' }))
  assert.throws(() => exigirPublico({ id_sigilo: '5' }), (e) => e instanceof ErroEproc && e.tipo === 'SIGILOSO')
})
