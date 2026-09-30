import type { Capa, Peca } from '../../agente/lib/caso.ts'
import { ErroEproc } from '../../agente/lib/erros.ts'
import { minimizar } from '../../agente/lib/minimizacao.ts'
import { formatarNumeroProcesso } from '../../agente/lib/numero.ts'
import type { Papel } from './pecas.ts'

const ROTULO: Record<Papel, string> = {
  decisao: 'DECISÃO RECORRIDA',
  recurso: 'RECURSO',
  inicial: 'PETIÇÃO INICIAL',
  contestacao: 'CONTESTAÇÃO',
}

export type Item = { papel: Papel; peca: Peca; texto: string }
export type Montagem = {
  texto: string
  chars: number
  limite: number
  excede: boolean
  /** Peças que terminam depois do limite: parte delas (ou todas) ficará de fora da leitura. */
  cortadas: string[]
}

/**
 * Monta o texto do caso: cabeçalho da capa e, em ordem, cada peça. `limite` é o
 * `max_chars_caso` do servidor (GET /api/config → busca.max_chars_caso): o
 * pipeline lê só os primeiros `limite` caracteres, então o painel avisa quem
 * fica de fora em vez de deixar o sistema "não enfrentar" um pedido em silêncio.
 * Minimiza de novo (é idempotente) porque este é o último ponto antes de o texto sair do
 * navegador, e recusa peça sigilosa com `SIGILOSO`.
 */
export function montarCaso(capa: Capa, itens: Item[], limite: number): Montagem {
  // limite indefinido (NaN) faria `excede` ser sempre false, e o aviso de corte sumiria calado
  if (!Number.isFinite(limite) || limite <= 0) throw new RangeError('limite do caso inválido: ' + limite)
  const polo = (nomes: string[]) => nomes.join('; ') || '—'
  const cabecalho = minimizar([
    `PROCESSO ${formatarNumeroProcesso(capa.numero)} — ${capa.classe} — ${capa.orgao}`,
    ...(capa.relator ? [`Relator: ${capa.relator}`] : []),
    ...(capa.assuntos.length ? [`Assuntos: ${capa.assuntos.join('; ')}`] : []),
    `Polo ativo: ${polo(capa.poloAtivo)}`,
    `Polo passivo: ${polo(capa.poloPassivo)}`,
  ].join('\n'))

  let texto = cabecalho
  const cortadas: string[] = []
  for (const { papel, peca, texto: corpo } of itens) {
    if (peca.sigiloso) throw new ErroEproc('SIGILOSO', peca.rotulo)
    texto += `\n\n=== ${ROTULO[papel]} — ${peca.rotulo} (evento ${peca.evento}, ${peca.data}) ===\n${minimizar(corpo.trim())}`
    if (texto.length > limite) cortadas.push(`${ROTULO[papel]} — ${peca.rotulo}`)
  }
  return { texto, chars: texto.length, limite, excede: texto.length > limite, cortadas }
}
