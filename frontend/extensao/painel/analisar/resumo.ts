import type { Consulta } from '../../../src/api.ts'

export type Resumo = { titulo: string; linhas: string[]; aviso: string | null }

const pct = (v: number) => `${Math.round(v)}%`
const milhares = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/**
 * O prognóstico em poucas linhas, com as MESMAS recusas do site (Consulta.tsx):
 * pediu um lado -> sem percentual, porque a amostra foi escolhida pela tese;
 * "não decido" -> sem percentual, com os motivos; caso cortado -> aviso de que o
 * final não foi lido. Um número que o sistema se recusou a cravar nunca aparece aqui.
 */
export function resumirPrognostico(c: Pick<Consulta, 'prognostico' | 'caso_cortado' | 'max_chars_caso'>): Resumo {
  const p = c.prognostico ?? {}
  const aviso = c.caso_cortado
    ? `O caso passou de ${typeof c.max_chars_caso === 'number' ? milhares(c.max_chars_caso) : 'o limite de'} caracteres e foi cortado antes da análise: o final não foi lido.`
    : null
  if (Object.keys(p).length === 0) return { titulo: 'O prognóstico ainda não foi calculado.', linhas: [], aviso }

  if (p.enviesado) {
    return {
      titulo: 'SEM PROGNÓSTICO — você pediu um lado',
      linhas: [
        'Os precedentes foram escolhidos por sustentarem a tese pedida; um percentual mediria a própria escolha.',
        'Para o número calibrado, rode a mesma consulta em modo neutro.',
      ],
      aviso,
    }
  }
  if (p.decide === false) {
    const motivos = p.confianca?.por_que?.length ? p.confianca.por_que : ['Os dados não sustentam um prognóstico neste caso.']
    return { titulo: 'NÃO DECIDO', linhas: [...motivos, 'As evidências continuam válidas: é com elas que se decide, não com o percentual.'], aviso }
  }

  const linhas: string[] = []
  if (Array.isArray(p.intervalo_pct) && p.intervalo_pct.length === 2) linhas.push(`intervalo de 80%: ${pct(p.intervalo_pct[0])} a ${pct(p.intervalo_pct[1])}`)
  if (typeof p.resultado_provavel === 'string' && p.resultado_provavel) linhas.push(`resultado mais provável: ${p.resultado_provavel}`)
  if (typeof p.n_precedentes === 'number') linhas.push(p.n_precedentes === 1 ? '1 precedente analisado' : `${p.n_precedentes} precedentes analisados`)
  if (typeof p.probabilidade_pct !== 'number') {
    return { titulo: 'Percentual indisponível', linhas: ['O sistema não crava um percentual neste caso; veja as evidências no site.', ...linhas], aviso }
  }
  linhas.push(p.calibrado ? 'Percentual calibrado.' : 'Sem calibrador treinado: o número ordena, mas não é uma probabilidade.')
  return { titulo: `${pct(p.probabilidade_pct)} de chance de reforma`, linhas, aviso }
}
