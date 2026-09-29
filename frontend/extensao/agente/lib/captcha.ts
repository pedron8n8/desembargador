import { ErroEproc } from './erros.ts'

// Único estado conhecido como "sem desafio" (HAR da JFRS, 25/09/2026). Todo o
// resto é tratado como desafio: a extensão para e manda o humano resolver na
// aba. Nunca tenta resolver nem contornar.
export function captchaLiberado(resposta: unknown): boolean {
  const c = (resposta as { captcha?: { captcha_imagem?: unknown; codigo_validade?: unknown } } | null)?.captcha
  return !!c && c.captcha_imagem === 'false' && Number(c.codigo_validade) === 1
}

export function exigirCaptchaLiberado(resposta: unknown): void {
  if (!captchaLiberado(resposta)) throw new ErroEproc('CAPTCHA')
}
