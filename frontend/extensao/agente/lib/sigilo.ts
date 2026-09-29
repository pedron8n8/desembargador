import { ErroEproc } from './erros.ts'

// Decisão do spec: sigiloso nunca sai do navegador. Na dúvida (campo ausente,
// title sem nível), conta como sigiloso — errar para o lado de não enviar.
export const itemSigiloso = (item: { id_sigilo?: unknown } | null | undefined) => String(item?.id_sigilo) !== '0'

export function nivelDoTitulo(title: string | null | undefined): number | null {
  const matches = (title ?? '').match(/n[ií]vel\s+(\d+)/gi)
  if (!matches) return null
  const levels = matches.map((m) => Number(m.replace(/\D/g, '')))
  return Math.max(...levels)
}

export const documentoSigiloso = (title: string | null | undefined) => (nivelDoTitulo(title) ?? 1) > 0

export function separar<T extends { id_sigilo?: unknown }>(itens: T[]) {
  const publicos = itens.filter((i) => !itemSigiloso(i))
  return { publicos, sigilosos: itens.length - publicos.length }
}

export function exigirPublico(item: { id_sigilo?: unknown }): void {
  if (itemSigiloso(item)) throw new ErroEproc('SIGILOSO')
}
