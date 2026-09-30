// CPF e CNPJ (inclusive o CNPJ alfanumérico, em vigor desde julho de 2026).
// Valide ANTES de consultar o eproc: documento com dígito errado volta como
// "nenhum processo", que parece uma resposta legítima.

export type TipoDocumento = 'cpf' | 'cnpj'

/** Só letras e dígitos, em maiúsculas: o que sobra depois de tirar a máscara. */
export const normalizar = (v: string) => String(v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()

/** `d` já normalizado. */
export function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const dv = (base: string) => {
    let s = 0
    for (let i = 0; i < base.length; i++) s += Number(base[i]) * (base.length + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(d.slice(0, 9)) === Number(d[9]) && dv(d.slice(0, 10)) === Number(d[10])
}

/** `d` já normalizado. Cada caractere vale o código ASCII menos 48 (A = 17, B = 18...). */
export function cnpjValido(d: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let s = 0
    for (let i = 0; i < base.length; i++) s += (base.charCodeAt(i) - 48) * pesos[i]
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

/** 'cpf', 'cnpj' ou null quando não é um documento válido (com ou sem máscara). */
export function tipoDoDocumento(v: string): TipoDocumento | null {
  const d = normalizar(v)
  if (cpfValido(d)) return 'cpf'
  if (cnpjValido(d)) return 'cnpj'
  return null
}

/**
 * O documento com a máscara que o campo de busca do eproc usa (a página envia o
 * valor mascarado; reproduzimos). null se não for um documento válido.
 */
export function mascarar(v: string): string | null {
  const d = normalizar(v)
  switch (tipoDoDocumento(v)) {
    case 'cpf':
      return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    case 'cnpj':
      return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    default:
      return null
  }
}
