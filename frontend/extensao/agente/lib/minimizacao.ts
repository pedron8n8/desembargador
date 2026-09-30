// O que identifica pessoa e não ajuda a análise (CPF, CNPJ, OAB) é tirado do
// texto ANTES de ele sair do agente — a minimização acontece na aba do eproc,
// não no servidor. Erra para o lado de tirar demais: um telefone de 11 dígitos
// vira [CPF], e tudo bem.
const UFS = 'AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO'

// A ordem importa: máscara antes de dígitos soltos, CNPJ (14) antes de CPF (11).
// O número de processo (20 dígitos, ou 7-2.4.1.2.4 com pontuação) não casa com
// nenhuma regra: os \b exigem que a sequência de dígitos termine ali.
// String.raw: num template comum, `\b` viraria um caractere de retrocesso.
const REGRAS: [RegExp, string][] = [
  [/\b[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}\b/g, '[CNPJ]'], // numérico ou alfanumérico
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[CPF]'],
  [/\b\d{14}\b/g, '[CNPJ]'],
  [/\b\d{11}\b/g, '[CPF]'],
  [new RegExp(String.raw`\bOAB\s*(?:[/-]\s*)?(?:${UFS})\s*(?:n[º°o.]*\s*)?[\d.]{3,9}[A-Z]?\b`, 'gi'), '[OAB]'], // OAB/SC 12.345
  [new RegExp(String.raw`\b(?:${UFS})\d{4,6}[A-Z]?\b`, 'g'), '[OAB]'], // RS012345, como aparece na tela
]

export function minimizar(texto: string): string {
  return REGRAS.reduce((t, [re, troca]) => t.replace(re, troca), texto)
}
