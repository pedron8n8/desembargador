import { useState } from 'react'

export type DadosConfronto = {
  caso: { numero: string; julgado_em: string; orgao: string; materia: string; real: string }
  peca_entregue: string
  real: { voto: string; dispositivo: string | null; acordao: string | null; ementa: string }
  gerada: string
  alinhamento: {
    elemento: string
    real: string
    gerada: string
    bate: boolean
    nota?: string
  }[]
  batem: number
  total: number
}

/**
 * O confronto: a decisão real do desembargador contra a que o sistema gerou
 * sozinho, com o processo escondido do índice.
 *
 * O que NÃO bate fica na tela, com o mesmo destaque do que bate. É o que dá
 * credibilidade ao resto — uma comparação que só mostra acerto é publicidade,
 * e quem está avaliando sabe disso.
 */
export function Confronto(
  { c, segundos, relator }: { c: DadosConfronto; segundos: number; relator: string },
) {
  const [aba, setAba] = useState<'alinhamento' | 'integra' | 'entrada'>('alinhamento')

  return (
    <>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {([
          ['alinhamento', 'Item a item'],
          ['integra', 'As duas decisões na íntegra'],
          ['entrada', 'O que foi entregue ao sistema'],
        ] as const).map(([k, r]) => (
          <button
            key={k}
            className="apr-sair"
            style={aba === k ? { color: 'var(--verde)', borderColor: 'var(--verde)' } : undefined}
            onClick={() => setAba(k)}
          >
            {r}
          </button>
        ))}
      </div>

      {/* a chave é a aba: trocar de aba remonta o bloco, e remontar dispara a
          entrada em CSS. Sem isso a troca é seca, e seca lê como recarga. */}
      <div className="apr-aba" key={aba}>
      {aba === 'alinhamento' && (
        <>
          <div className="apr-confronto">
            <div className="apr-coluna real">
              <header>
                <strong>O que o desembargador decidiu</strong>
                <span>Acórdão real · {c.caso.julgado_em} · {c.caso.orgao}</span>
              </header>
              <div className="apr-texto">{c.real.dispositivo ?? '—'}</div>
            </div>
            <div className="apr-coluna gerada">
              <header>
                <strong>O que o sistema escreveu</strong>
                <span>Gerado às cegas, sem ver o acórdão · {segundos} segundos</span>
              </header>
              <div className="apr-texto">
                {c.alinhamento.find((a) => a.elemento === 'DISPOSITIVO')?.gerada ?? '—'}
              </div>
            </div>
          </div>

          <div className="apr-linhas">
            {c.alinhamento.map((a) => (
              <div key={a.elemento} className={`apr-linha${a.bate ? ' bate' : ''}`}>
                <span className="rot">{a.elemento}</span>
                <q>{a.real}</q>
                <q className="g">{a.gerada}</q>
                <span className={`apr-selo ${a.bate ? 'sim' : 'nao'}`}>
                  {a.bate ? 'bate' : 'diverge'}
                </span>
                {a.nota && <p className="nota">{a.nota}</p>}
              </div>
            ))}
          </div>

          <p className="apr-dica">
            {c.batem} de {c.total} elementos batem. Os {c.total - c.batem} divergentes estão
            acima com a explicação, inclusive a citação que o sistema inventou e que o juiz
            automático apontou.
          </p>
        </>
      )}

      {aba === 'integra' && (
        <div className="apr-confronto">
          <div className="apr-coluna real">
            <header>
              <strong>Acórdão real</strong>
              <span>Des. {relator} · {c.caso.julgado_em}</span>
            </header>
            <div className="apr-texto">{c.real.voto}</div>
          </div>
          <div className="apr-coluna gerada">
            <header>
              <strong>Minuta gerada pelo sistema</strong>
              <span>Sem ver o acórdão · decisão escondida do índice</span>
            </header>
            <div className="apr-texto">{c.gerada}</div>
          </div>
        </div>
      )}

      {aba === 'entrada' && (
        <div className="apr-confronto" style={{ gridTemplateColumns: '1fr' }}>
          <div className="apr-coluna">
            <header>
              <strong>O arquivo que entrou no sistema</strong>
              <span>
                O relatório do próprio acórdão: a síntese que o tribunal faz da decisão
                recorrida e das razões recursais, cortada antes do voto
              </span>
            </header>
            <div className="apr-texto">{c.peca_entregue}</div>
          </div>
        </div>
      )}
      </div>
    </>
  )
}
