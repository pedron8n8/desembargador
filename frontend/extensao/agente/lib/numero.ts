// Número CNJ de 20 dígitos (sem pontuação, como vem no JSON de busca do eproc)
// para o formato de exibição NNNNNNN-DD.AAAA.J.TR.OOOO. Qualquer outra coisa
// volta como veio: melhor mostrar o texto original do que inventar formato.
export function formatarNumeroProcesso(nr: string): string {
  return /^\d{20}$/.test(nr) ? nr.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6') : nr
}
