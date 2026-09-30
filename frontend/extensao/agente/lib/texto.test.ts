import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerTexto, TETO_TEXTO } from './texto.ts'

const leitor = (selecao: string, pagina: string) => ({ selecao: () => selecao, pagina: () => pagina })

test('a seleção do advogado ganha da página', () => {
  assert.deepEqual(lerTexto(leitor('  trecho escolhido ', 'página inteira')), { texto: 'trecho escolhido', fonte: 'selecao', cortado: false })
})

test('sem seleção (vazia ou só espaços), vale o texto da página', () => {
  assert.deepEqual(lerTexto(leitor('', 'página inteira')), { texto: 'página inteira', fonte: 'pagina', cortado: false })
  assert.equal(lerTexto(leitor('  \n ', 'página')).fonte, 'pagina')
})

test('o texto sai minimizado, seja da seleção ou da página', () => {
  assert.equal(lerTexto(leitor('CPF 529.982.247-25', '')).texto, 'CPF [CPF]')
  assert.equal(lerTexto(leitor('', 'empresa CNPJ 11.222.333/0001-81, OAB/SC 12.345')).texto, 'empresa CNPJ [CNPJ], [OAB]')
})

test('acima do teto corta e avisa; exatamente no teto não corta', () => {
  assert.deepEqual(lerTexto(leitor('abcdef', ''), 4), { texto: 'abcd', fonte: 'selecao', cortado: true })
  assert.deepEqual(lerTexto(leitor('abcd', ''), 4), { texto: 'abcd', fonte: 'selecao', cortado: false })
  assert.equal(TETO_TEXTO, 100_000)
})

test('o corte vem DEPOIS da minimização: um número na borda não fica pela metade', () => {
  // sem minimizar antes, o corte em 14 deixaria "CPF 529.982.247" (nove dígitos de um CPF)
  assert.deepEqual(lerTexto(leitor('CPF 529.982.247-25 fim', ''), 14), { texto: 'CPF [CPF] fim', fonte: 'selecao', cortado: false })
})

test('página vazia devolve texto vazio, sem erro', () => {
  assert.deepEqual(lerTexto(leitor('', '')), { texto: '', fonte: 'pagina', cortado: false })
})
