// Só lê a página atual — nenhuma requisição. Seletores vistos no HTML da JFRS
// (HAR de 25/09/2026); conferir contra o TJSC quando o HAR de lá chegar
// (docs/eproc-roteiro-captura.md).
import { ErroEproc } from './erros.ts'

export type Instancia = '1g' | '2g'
export type Estado = { logado: boolean; instancia: Instancia | null; processo: string | null }
export type DocLike = { querySelector(sel: string): unknown; body: { className: string } | null }

export function lerEstado(doc: DocLike, url: string): Estado {
  // Botão "sair" só existe logado; campo de senha só na tela de login. Nenhum
  // dos dois, ou os dois juntos, é tela que não conhecemos: LAYOUT, nunca um
  // "não logado" com cara de resposta.
  const sair = !!doc.querySelector('#btn-encerrar-sessao')
  const senha = !!doc.querySelector('input[type="password"]')
  if (senha && !sair) return { logado: false, instancia: null, processo: null }
  if (sair === senha) throw new ErroEproc('LAYOUT')
  const u = new URL(url)
  const classe = /\binstancia-(1g|2g)\b/.exec(doc.body?.className ?? '')?.[1] as Instancia | undefined
  const instancia: Instancia = classe ?? (u.hostname.startsWith('eproc2g.') ? '2g' : '1g')
  const num = u.searchParams.get('num_processo') ?? ''
  const processo = u.searchParams.get('acao') === 'processo_selecionar' && /^\d{20}$/.test(num) ? num : null
  return { logado: true, instancia, processo }
}
