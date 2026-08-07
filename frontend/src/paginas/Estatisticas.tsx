import { useQuery } from '@tanstack/react-query'

import { get } from '../api'
import { Barras, Confiabilidade, Serie } from '../comp/Grafico'
import { pct, usd } from '../hooks'

const q = <T,>(chave: string, rota: string) => ({
  queryKey: [chave],
  queryFn: () => get<T>(rota),
  staleTime: 5 * 60_000,
})

export function Estatisticas() {
  const { data: corpus } = useQuery(q<any>('est-corpus', '/api/estatisticas/corpus'))
  const { data: deriva } = useQuery(q<any>('est-deriva', '/api/estatisticas/deriva'))
  const { data: classes } = useQuery(q<any>('est-classes', '/api/estatisticas/classes'))
  const { data: orgaos } = useQuery(q<any>('est-orgaos', '/api/estatisticas/orgaos'))
  const { data: cal } = useQuery(q<any>('calibracao', '/api/estatisticas/calibracao'))
  const { data: abst } = useQuery(q<any>('est-abstencao', '/api/estatisticas/abstencao'))
  const { data: conc } = useQuery(q<any>('est-concordancia', '/api/estatisticas/concordancia'))
  const { data: custos } = useQuery(q<any>('custos', '/api/estatisticas/custos'))

  if (!corpus) return <p className="vazio">carregando…</p>

  const anos = corpus.por_ano.map((a: any) => ({
    rotulo: String(a.ano),
    valor: a.reforma_pct,
    n: a.n,
  }))
  const faixa = anos.length
    ? Math.max(...anos.map((a: any) => a.valor)) - Math.min(...anos.map((a: any) => a.valor))
    : 0

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Estatísticas</h1>
          <p className="sub">
            {corpus.total.toLocaleString('pt-BR')} decisões, {corpus.primeiro_ano}–
            {corpus.ultimo_ano}
          </p>
        </div>
      </header>

      <section className="secao">
        <h2>Deriva de época</h2>
        <p className="nota">
          Taxa de reforma por ano, só em anos com pelo menos {corpus.minimo_ano} decisões de
          mérito. A variação de <b>{faixa.toFixed(1)} pontos</b> é maior que boa parte do sinal
          que o modelo explora — não é humor do julgador, é jurisprudência que consolida, lei que
          muda e composição do acervo que muda junto. É por isso que o calibrador é ajustado em
          janela recente e que a média de duas décadas não descreve o tribunal de hoje.
        </p>
        <Serie dados={anos} />
        {corpus.anos_fora_da_serie?.length > 0 && (
          <p className="nota">
            Fora da série por amostra pequena:{' '}
            {corpus.anos_fora_da_serie.map((a: any) => `${a.ano} (n=${a.n})`).join(', ')}.
          </p>
        )}
      </section>

      {deriva && (
        <section className="secao">
          <h2>O resultado depende de algo que não deveria?</h2>
          <p className="nota">
            Dia da semana é a boa notícia: não há efeito de segunda-feira. A carga do dia parece
            efeito, mas está confundida com sessão × monocrática — controlada só entre acórdãos,
            ela encolhe. A âncora citada é o único dos quatro que é sinal jurídico, e é o que o
            re-ranking usa.
          </p>
          <h3 style={{ fontSize: 'var(--t-md)', marginBottom: 'var(--e2)' }}>Dia da semana</h3>
          <Barras dados={deriva.por_dia_semana} altura={140} />
          <h3 style={{ fontSize: 'var(--t-md)', margin: 'var(--e8) 0 var(--e2)' }}>
            Carga do dia — bruta
          </h3>
          <Barras dados={deriva.por_carga} altura={140} />
          <h3 style={{ fontSize: 'var(--t-md)', margin: 'var(--e8) 0 var(--e2)' }}>
            Carga do dia — só entre acórdãos (controlada)
          </h3>
          <Barras dados={deriva.por_carga_controlada} altura={140} />
          <h3 style={{ fontSize: 'var(--t-md)', margin: 'var(--e8) 0 var(--e2)' }}>Âncora citada</h3>
          <Barras dados={deriva.por_ancora} altura={140} />
        </section>
      )}

      {classes && (
        <section className="secao">
          <h2>Taxa de reforma por classe e por câmara</h2>
          <p className="nota">
            Só onde há pelo menos {classes.minimo} decisões de mérito. “Por quem” aqui é qual
            câmara: o acervo é de um relator só, e não dá para comparar relatores com estes dados.
          </p>
          <Barras dados={classes.itens.map((x: any) => ({ rotulo: x.rotulo, valor: x.reforma_pct, n: x.n }))} />
          {orgaos && (
            <div style={{ marginTop: 'var(--e8)' }}>
              <Barras dados={orgaos.itens.map((x: any) => ({ rotulo: x.rotulo, valor: x.reforma_pct, n: x.n }))} />
            </div>
          )}
        </section>
      )}

      {cal && (
        <section className="secao">
          <h2>A escala mente?</h2>
          {!cal.calibrado ? (
            <p className="aviso forte">
              Sem calibrador. O número do prognóstico ordena bem, mas não é probabilidade. Rode{' '}
              <code>python -m src.rag.calibrar --ajustar</code>.
            </p>
          ) : cal.tem_curva ? (
            <>
              <p className="nota">
                Curva de confiabilidade medida em {cal.ano_validacao}, fora do ajuste: quanto mais
                perto da diagonal, mais o percentual quer dizer o que diz. Brier caiu de{' '}
                {cal.brier_antes?.toFixed(3)} para {cal.brier_depois?.toFixed(3)}; o maior erro da
                diagonal, de {pct(100 * cal.erro_antes, 1)} para {pct(100 * cal.erro_depois, 1)}.
              </p>
              <div style={{ display: 'flex', gap: 'var(--e8)', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--t-md)' }}>antes</h3>
                  <Confiabilidade curva={cal.curva_antes} />
                </div>
                <div>
                  <h3 style={{ fontSize: 'var(--t-md)' }}>depois</h3>
                  <Confiabilidade curva={cal.curva_depois} />
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="nota">
                O calibrador existe (ajustado em {cal.ano_ajuste} com {cal.n?.toLocaleString('pt-BR')}{' '}
                casos), mas foi gerado antes de as curvas passarem a ser guardadas no arquivo.
                Abaixo está só a função de transferência — o que ele faz com cada valor bruto.
                Para ver a curva de confiabilidade medida, reajuste com{' '}
                <code>python -m src.rag.calibrar --ajustar</code>.
              </p>
              <Serie
                dados={cal.transferencia
                  .filter((_: any, i: number) => i % 5 === 0)
                  .map((t: any) => ({
                    rotulo: `${(100 * t.bruto).toFixed(0)}%`,
                    valor: 100 * t.calibrado,
                  }))}
              />
            </>
          )}
        </section>
      )}

      {abst && (
        <section className="secao">
          <h2>Com que frequência o sistema crava</h2>
          <p className="nota">
            <b>Medido no seu uso</b>, não no benchmark: {abst.n} consultas registradas, cravou em{' '}
            {abst.n ? pct(abst.cobertura_pct) : '—'}. O número do benchmark (37,8% de cobertura a
            96,7% de acerto) vem de 400 casos cegos com gabarito e tem outra distribuição de
            casos — os dois respondem perguntas diferentes.
          </p>
          {abst.distribuicao?.length > 0 && (
            <Barras
              dados={abst.distribuicao.map((d: any) => ({
                rotulo: `${d.faixa}–${d.faixa + 10}%`,
                valor: d.n,
              }))}
              sufixo=""
              altura={140}
            />
          )}
        </section>
      )}

      <section className="secao">
        <h2>O juiz automático concorda com você?</h2>
        <p className="nota">
          Sem isso o bench de modelos não vale nada: se o juiz não acompanha a sua nota, trocar de
          modelo pela nota dele é trocar às cegas.
        </p>
        {conc?.concordancia?.n >= 2 ? (
          <div className="faixa">
            <div className="medida">
              <dt>pares avaliados</dt>
              <dd>{conc.concordancia.n}</dd>
            </div>
            <div className="medida">
              <dt>sua média</dt>
              <dd>{conc.concordancia.media_humano}</dd>
            </div>
            <div className="medida">
              <dt>média do juiz</dt>
              <dd>{conc.concordancia.media_juiz}</dd>
            </div>
            <div className="medida">
              <dt>erro médio</dt>
              <dd>{conc.concordancia.erro_medio}</dd>
            </div>
            <div className="medida">
              <dt>correlação</dt>
              <dd>{conc.concordancia.correlacao ?? '—'}</dd>
            </div>
          </div>
        ) : (
          <p className="vazio">
            Ainda não há pares suficientes. Avalie algumas consultas — abaixo de ~8 pares isso não
            significa nada.
          </p>
        )}
      </section>

      {custos && custos.por_dia?.length > 0 && (
        <section className="secao">
          <h2>Livro-caixa</h2>
          <p className="nota">
            Total {usd(custos.total_usd)}. O custo é o real devolvido pelo OpenRouter em cada
            chamada, não uma estimativa por tabela de preços.
          </p>
          <Barras
            dados={custos.por_dia.map((d: any) => ({ rotulo: d.dia.slice(5), valor: d.usd }))}
            sufixo=""
          />
          <div style={{ display: 'flex', gap: 'var(--e8)', flexWrap: 'wrap', marginTop: 'var(--e6)' }}>
            <div style={{ flex: '1 1 300px' }}>
              <h3 style={{ fontSize: 'var(--t-md)', marginBottom: 'var(--e2)' }}>por nó</h3>
              <table>
                <thead>
                  <tr>
                    <th>nó</th>
                    <th className="num">chamadas</th>
                    <th className="num">US$</th>
                  </tr>
                </thead>
                <tbody>
                  {custos.por_no.map((x: any) => (
                    <tr key={x.no}>
                      <td>{x.no}</td>
                      <td className="num">{x.chamadas}</td>
                      <td className="num">{x.usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ flex: '1 1 340px' }}>
              <h3 style={{ fontSize: 'var(--t-md)', marginBottom: 'var(--e2)' }}>por modelo</h3>
              <table>
                <thead>
                  <tr>
                    <th>modelo</th>
                    <th className="num">chamadas</th>
                    <th className="num">US$</th>
                  </tr>
                </thead>
                <tbody>
                  {custos.por_modelo.map((x: any) => (
                    <tr key={x.modelo}>
                      <td className="mono">{x.modelo}</td>
                      <td className="num">{x.chamadas}</td>
                      <td className="num">{x.usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="secao">
        <h2>Composição do acervo</h2>
        <div style={{ display: 'flex', gap: 'var(--e8)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px' }}>
            <h3 style={{ fontSize: 'var(--t-md)', marginBottom: 'var(--e2)' }}>por resultado</h3>
            <table>
              <tbody>
                {corpus.por_resultado.map((x: any) => (
                  <tr key={x.rotulo}>
                    <td>{x.rotulo}</td>
                    <td className="num">{x.n.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ flex: '1 1 280px' }}>
            <h3 style={{ fontSize: 'var(--t-md)', marginBottom: 'var(--e2)' }}>por âncora</h3>
            <table>
              <thead>
                <tr>
                  <th>alcance</th>
                  <th className="num">n</th>
                  <th className="num">reforma</th>
                </tr>
              </thead>
              <tbody>
                {corpus.por_ancora.map((x: any) => (
                  <tr key={x.rotulo}>
                    <td>{x.rotulo}</td>
                    <td className="num">{x.n.toLocaleString('pt-BR')}</td>
                    <td className="num">{pct(x.reforma_pct, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <h3 style={{ fontSize: 'var(--t-md)', marginBottom: 'var(--e2)' }}>por votação</h3>
            <table>
              <tbody>
                {corpus.por_unanimidade.map((x: any) => (
                  <tr key={x.rotulo}>
                    <td>{x.rotulo}</td>
                    <td className="num">{x.n.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
