import { test } from 'node:test'
import assert from 'node:assert/strict'
import { corpoDaConsulta, LIMITE_ENVIO, type Origem } from './apiAnalise.ts'

const ORIGEM: Origem = { eproc: '50012345620208240023', instancia: '1g' }
const base = { texto: 'caso de teste', cerebro: 'rubens-schulz', tese: 'neutra' as const, soPrognostico: false, origem: ORIGEM }

test('o corpo tem exatamente os campos que o servidor lê', () => {
  assert.deepEqual(corpoDaConsulta(base), {
    caso: 'caso de teste', tese: 'neutra', cerebro: 'rubens-schulz', so_prognostico: false, origem: ORIGEM,
  })
  assert.equal(corpoDaConsulta({ ...base, soPrognostico: true, tese: 'reformar' }).so_prognostico, true)
})

test('o texto editado à mão é minimizado de novo e aparado antes de sair', () => {
  const c = corpoDaConsulta({ ...base, texto: '  parte CPF 529.982.247-25, OAB/SC 12.345\n ' })
  assert.equal(c.caso, 'parte CPF [CPF], [OAB]')
})

test('caso vazio e cérebro vazio são recusados antes da rede', () => {
  assert.throws(() => corpoDaConsulta({ ...base, texto: '  \n ' }), /vazio/)
  assert.throws(() => corpoDaConsulta({ ...base, cerebro: '' }), /cérebro/)
})

test('acima do limite do servidor (413) é recusado aqui, com a mensagem de quanto passou', () => {
  assert.doesNotThrow(() => corpoDaConsulta({ ...base, texto: 'a'.repeat(LIMITE_ENVIO) }))
  assert.throws(() => corpoDaConsulta({ ...base, texto: 'a'.repeat(LIMITE_ENVIO + 1) }), (e) => e instanceof RangeError && /120000/.test(e.message))
})

test('sem origem (texto que não veio de um processo identificado), o corpo não leva o campo', () => {
  const { origem: _omitida, ...semOrigem } = base
  const c = corpoDaConsulta(semOrigem)
  assert.equal('origem' in c, false)
  assert.equal(c.caso, 'caso de teste')
})
