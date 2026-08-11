import { Link } from 'react-router-dom'

import type { Precedente as P } from '../api'
import { useCerebroEfetivo } from '../cerebro'
import { dataBR } from '../hooks'

export function SeloResultado({ r }: { r: string | null | undefined }) {
  const classe =
    r === 'provido'
      ? 'provido'
      : r === 'parcialmente provido'
        ? 'parcial'
        : r === 'desprovido'
          ? 'desprovido'
          : 'processual'
  return <span className={`selo ${classe}`}>{r ?? '—'}</span>
}

/**
 * O átomo do produto, repetido em toda tela.
 *
 * A ordem interna não é livre: identificação → ficha de procedência → por que
 * ficou nessa posição no ranking → ementa → link para o TJSC. É a mesma ordem
 * de `cli.formatar`, e ela põe a evidência antes de qualquer número.
 */
export function Precedente({
  p,
  veredito,
  onVeredito,
  detalhe = true,
  cerebro,
}: {
  p: P
  veredito?: string | null
  onVeredito?: (v: 'util' | 'inutil' | null) => void
  detalhe?: boolean
  /** de qual acervo é este precedente. Numa comparação, cada coluna tem o seu —
   *  por isso é prop, e não só o cérebro selecionado na lateral. */
  cerebro?: string
}) {
  const [selecionado] = useCerebroEfetivo()
  // o id só é único DENTRO de um acervo: sem o slug no link, clicar num
  // precedente abriria a decisão de mesmo id no cérebro errado
  const dono = cerebro || selecionado
  return (
    <article className="prec">
      <div className="prec-topo">
        <Link className="prec-numero" to={`/acervo/${dono}/${p.id}`}>
          {p.numero}
        </Link>
        <SeloResultado r={p.resultado} />
        <span className="prec-meta">
          {[p.classe, p.comarca, p.orgao].filter(Boolean).join(' · ')} · {dataBR(p.data)}
        </span>
        {p.nota != null && (
          <span className="prec-analogia">
            analogia {p.nota}/5{p.por_que ? ` — ${p.por_que}` : ''}
          </span>
        )}
      </div>

      {detalhe && (
        <>
          <div className="prec-linha">
            <b>Procedência</b>
            {p.ficha}
          </div>
          <div className="prec-linha">
            <b>Ranking</b>
            {p.explicacao_rank}
          </div>
        </>
      )}

      {p.ementa && (
        <p className="prec-ementa">
          {p.ementa}
          {p.ementa_truncada && <span className="prec-meta"> […]</span>}
        </p>
      )}

      <div className="prec-acoes nao-imprime">
        {p.url && (
          <a className="leve" href={p.url} target="_blank" rel="noreferrer noopener">
            ver no TJSC
          </a>
        )}
        {onVeredito && (
          <>
            <span>este precedente serviu?</span>
            <button
              type="button"
              className="leve"
              aria-pressed={veredito === 'util'}
              onClick={() => onVeredito(veredito === 'util' ? null : 'util')}
            >
              serviu
            </button>
            <button
              type="button"
              className="leve"
              aria-pressed={veredito === 'inutil'}
              onClick={() => onVeredito(veredito === 'inutil' ? null : 'inutil')}
            >
              não serviu
            </button>
          </>
        )}
      </div>
    </article>
  )
}
