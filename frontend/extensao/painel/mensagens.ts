import type { ErroPainel } from './fluxo.ts'

export type Acao = 'abrir_login' | 'abrir_eproc' | 'focar_eproc' | 'tentar_de_novo' | 'copiar_diagnostico' | null

// Textos da tabela "Erros na tela" do spec. Record<ErroPainel, ...> faz o tsc
// recusar erro novo sem mensagem.
export const MENSAGENS: Record<ErroPainel, { texto: string; acao: Acao }> = {
  SISTEMA_FORA: { texto: 'O nosso sistema não respondeu. Tente de novo em instantes.', acao: 'tentar_de_novo' },
  SEM_ABA_EPROC: { texto: 'Abra o eproc do TJSC e faça login.', acao: 'abrir_eproc' },
  NAO_LOGADO: { texto: 'Sua sessão no eproc caiu. Entre de novo no eproc.', acao: 'focar_eproc' },
  CAPTCHA: {
    texto: 'O eproc pediu uma verificação. Faça uma consulta manual na aba do eproc e tente de novo.',
    acao: 'tentar_de_novo',
  },
  SIGILOSO: {
    texto: 'Este processo está em sigilo. Por segurança, a extensão não envia processos sigilosos para análise.',
    acao: null,
  },
  LAYOUT: { texto: 'O eproc mudou e a extensão não reconheceu a tela. Avise o suporte.', acao: 'copiar_diagnostico' },
  EPROC_FORA: { texto: 'O eproc não respondeu.', acao: 'tentar_de_novo' },
}

// Vai para o suporte: versão e erro, nunca número de processo nem nome.
export const diagnostico = (erro: ErroPainel, versao: string) =>
  `Segundo Cérebro — eproc ${versao}\nerro: ${erro}\nprimitiva: estado\nnavegador: ${globalThis.navigator?.userAgent ?? '?'}`
