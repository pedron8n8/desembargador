import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ID_BOTAO, montarBotao, type DocMinimo, type ElementoMinimo } from './botao.ts'

// DOM de mentira: só registra o que o código faz, para testar sem navegador.
class Falso implements ElementoMinimo {
  id = ''
  title = ''
  textContent: string | null = null
  style = { cssText: '' }
  filhos: unknown[] = []
  raiz: { filhos: unknown[]; append(...f: unknown[]): void } | null = null
  cliques: (() => void)[] = []
  tag: string
  constructor(tag: string) { this.tag = tag }
  append(...f: unknown[]) { this.filhos.push(...f) }
  attachShadow() {
    this.raiz = { filhos: [], append(...f: unknown[]) { this.filhos.push(...f) } }
    return this.raiz
  }
  addEventListener(tipo: string, f: () => void) { if (tipo === 'click') this.cliques.push(f) }
}
const docFalso = (comCorpo = true) => {
  const corpo = new Falso('body')
  const doc: DocMinimo & { corpo: Falso } = {
    corpo,
    createElement: (tag) => new Falso(tag),
    getElementById: (id) => corpo.filhos.find((f) => (f as Falso).id === id) ?? null,
    body: comCorpo ? corpo : null,
  }
  return doc
}

test('cria o botão dentro de um shadow DOM fechado, fixo no canto, com o rótulo e o clique ligados', () => {
  const doc = docFalso()
  let cliques = 0
  assert.equal(montarBotao(doc, () => cliques++), true)
  const hospedeiro = doc.corpo.filhos[0] as Falso
  assert.equal(hospedeiro.id, ID_BOTAO)
  assert.match(hospedeiro.style.cssText, /position:fixed/)
  const [estilo, botao] = hospedeiro.raiz!.filhos as Falso[]
  assert.equal(estilo.tag, 'style')
  assert.equal(botao.textContent, 'Segundo Cérebro')
  botao.cliques[0]()
  assert.equal(cliques, 1)
})

test('chamar de novo não duplica o botão', () => {
  const doc = docFalso()
  assert.equal(montarBotao(doc, () => {}), true)
  assert.equal(montarBotao(doc, () => {}), false)
  assert.equal(doc.corpo.filhos.length, 1)
})

test('página sem corpo (ainda carregando): não faz nada e não quebra', () => {
  const doc = docFalso(false)
  assert.equal(montarBotao(doc, () => {}), false)
  assert.equal(doc.corpo.filhos.length, 0)
})
