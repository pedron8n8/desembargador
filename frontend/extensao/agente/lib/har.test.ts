// Roda contra qualquer *.har na raiz do repositório. HAR NUNCA entra no git
// (tem nome real de parte), então na máquina de quem não tem o arquivo este
// teste é pulado e diz isso.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { captchaLiberado } from './captcha.ts'
import { separar } from './sigilo.ts'

const RAIZ = join(import.meta.dirname, '..', '..', '..', '..')
const hars = readdirSync(RAIZ).filter((f) => f.endsWith('.har'))

type Entrada = { request: { url: string; method: string }; response: { content: { text?: string } } }

for (const har of hars) {
  const entradas: Entrada[] = JSON.parse(readFileSync(join(RAIZ, har), 'utf8')).log.entries
  const respostas = (trecho: string) =>
    entradas.filter((e) => e.request.url.includes(trecho) && e.request.method === 'POST').map((e) => JSON.parse(e.response.content.text ?? 'null'))

  test(`${har}: estado de captcha gravado é reconhecido`, (t) => {
    const r = respostas('verifica_estado_captcha')
    if (!r.length) return t.skip('sem verifica_estado_captcha neste HAR')
    for (const x of r) assert.equal(captchaLiberado(x), x.captcha.captcha_imagem === 'false' && Number(x.captcha.codigo_validade) === 1)
  })

  test(`${har}: busca por documento separa públicos e sigilosos sem perder nenhum`, (t) => {
    const r = respostas('processos_consulta_por_documento_identificacao')
    if (!r.length) return t.skip('sem busca por documento neste HAR')
    for (const x of r) {
      assert.ok(Array.isArray(x.resultados), 'resultados ausente seria LAYOUT')
      const s = separar(x.resultados)
      assert.equal(s.publicos.length + s.sigilosos, x.resultados.length)
    }
  })
}

test('HAR presente na raiz', (t) => {
  if (!hars.length) t.skip('nenhum *.har na raiz; testes contra tráfego real pulados')
})
