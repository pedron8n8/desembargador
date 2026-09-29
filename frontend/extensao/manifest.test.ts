import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EPROC_HOSTS, montarManifest } from './manifest.ts'

test('permissões mínimas exigidas pela loja', () => {
  const m = montarManifest('https://sistema.exemplo.com.br')
  assert.deepEqual(m.permissions, ['sidePanel', 'scripting'])
  assert.deepEqual(m.host_permissions, [...EPROC_HOSTS, 'https://sistema.exemplo.com.br/*'])
  const tudo = JSON.stringify(m)
  for (const proibido of ['"cookies"', '"tabs"', '<all_urls>']) assert.ok(!tudo.includes(proibido), proibido)
})

test('agente só roda no eproc do TJSC', () => {
  const m = montarManifest('https://sistema.exemplo.com.br')
  assert.deepEqual(m.content_scripts, [{ matches: EPROC_HOSTS, js: ['agente.js'], run_at: 'document_idle' }])
  assert.deepEqual(EPROC_HOSTS, ['https://eproc1g.tjsc.jus.br/*', 'https://eproc2g.tjsc.jus.br/*'])
})

test('base da API: caminho e barra final não vazam para a permissão', () => {
  const m = montarManifest('https://sistema.exemplo.com.br/qualquer/')
  assert.equal(m.host_permissions?.at(-1), 'https://sistema.exemplo.com.br/*')
})

test('http só em localhost', () => {
  assert.equal(montarManifest('http://localhost:5173').host_permissions?.at(-1), 'http://localhost:5173/*')
  assert.throws(() => montarManifest('http://sistema.exemplo.com.br'), /https/)
})

test('base ausente ou inválida falha o build', () => {
  assert.throws(() => montarManifest(''), /EXT_API_BASE/)
  assert.throws(() => montarManifest('não é url'), /EXT_API_BASE/)
})
