// Conjunto FECHADO. O painel tem uma mensagem e uma ação para cada um
// (painel/mensagens.ts). Erro novo aqui sem mensagem lá é o que o teste de
// mensagens pega.
export type TipoErro = 'NAO_LOGADO' | 'CAPTCHA' | 'LAYOUT' | 'EPROC_FORA' | 'SIGILOSO' | 'SEM_ABA_EPROC'

export class ErroEproc extends Error {
  tipo: TipoErro
  constructor(tipo: TipoErro, detalhe?: string) {
    super(detalhe ? tipo + ': ' + detalhe : tipo)
    this.tipo = tipo
  }
}
