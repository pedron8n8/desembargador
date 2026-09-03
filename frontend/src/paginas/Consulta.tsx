import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'

import { get, post, type Consulta as C, type Pesos, type Rede } from '../api'
import { Confiabilidade } from '../comp/Grafico'
import { Markdown } from '../comp/Markdown'
import { PainelPesos } from '../comp/PainelPesos'
import { PipelineAoVivo } from '../comp/PipelineAoVivo'
import { Precedente } from '../comp/Precedente'
import { RedePrecedentes } from '../comp/RedePrecedentes'
import { pct, usd, useEventos } from '../hooks'

// A ordem NÃO é estética: quem lê o percentual primeiro ancora nele e lê o resto
// procurando confirmação. É a mesma ordem de cli.formatar — evidência antes de
// veredito. Ver frontend/DESIGN.md antes de reordenar por conveniência de layout.
const ABAS = [
  ['evidencias', 'Evidências'],
  ['prognostico', 'Prognóstico'],
  ['minuta', 'Minuta'],
  ['pesos', 'Pesos'],
  ['rede', 'Rede'],
  ['custo', 'Custo'],
] as const

const RODANDO = new Set(['fila', 'rodando'])

export function Consulta() {
  const { thread, aba = 'evidencias' } = useParams()
  const qc = useQueryClient()

  const [retomando, setRetomando] = useState(false)

  const { data: c, isLoading, error } = useQuery({
    queryKey: ['consulta', thread],
    queryFn: () => get<C>(`/api/consultas/${thread}`),
    retry: false,
    // sem isto a tela congela no estado da primeira leitura: quem retoma vê o
    // 202 e mais nada. Mesmo intervalo do painel e da comparação.
    refetchInterval: (q) =>
      RODANDO.has((q.state.data as C | undefined)?.estado ?? '') ? 4000 : false,
  })

  const rodando = !!c && RODANDO.has(c.estado)
  const parado = !!c && (c.estado === 'erro' || c.estado === 'interrompido')
  // numa consulta PARADA o stream fica aberto de propósito: é por ele que os
  // eventos de uma retomada chegam. Fechá-lo era o que fazia o clique não dar
  // sinal nenhum — o 202 voltava e a tela continuava idêntica.
  const vivo = useEventos(thread, rodando || parado || (!c && !error))

  // quando o SSE diz que acabou, o relatório inteiro passa a existir
  useEffect(() => {
    if (vivo.concluido) {
      qc.invalidateQueries({ queryKey: ['consulta', thread] })
      qc.invalidateQueries({ queryKey: ['consultas'] })
    }
  }, [vivo.concluido, qc, thread])

  if (isLoading && !c) return <p className="vazio">carregando…</p>

  if (error && !c) {
    return (
      <>
        <header className="cabecalho">
          <h1>Consulta</h1>
        </header>
        <PipelineAoVivo vivo={vivo} />
        <p className="aviso" style={{ marginTop: 'var(--e6)' }}>
          O relatório aparece assim que o primeiro nó terminar.
        </p>
      </>
    )
  }
  if (!c) return null

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>{c.triagem.materia || 'Consulta'}</h1>
          <p className="sub">
            <b>
              {c.cerebro_titulo} {c.cerebro_nome}
            </b>
            {' · '}
            <span className="mono">{c.thread}</span>
            {c.triagem.classe && ` · ${c.triagem.classe}`}
            {c.tese !== 'neutra' && ` · sustentando ${c.tese}`}
            {c.segundos != null && ` · ${Math.round(c.segundos)}s`}
            {' · '}
            {usd(c.custo_total)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--e2)' }} className="nao-imprime">
          <Link className="leve" to={`/conversa/${c.thread}`}>
            perguntar sobre esta análise
          </Link>
          <a className="leve" href={`/api/consultas/${c.thread}/markdown`} download>
            baixar .md
          </a>
        </div>
      </header>

      <div className="aviso" style={{ marginBottom: 'var(--e6)' }}>
        <strong>Este documento põe as evidências na mesa. Ele não decide.</strong> Abaixo estão
        decisões públicas do relator, contadas e ordenadas, mais uma minuta gerada por IA a
        partir delas. Não é a posição do desembargador e não deve ser apresentada como tal.
        Confira cada citação.
      </div>

      {/* fora de qualquer aba de proposito: quem nao baixa o .md tambem
          precisa saber que parte do caso nunca chegou aos nos de LLM. */}
      {c.caso_cortado && (
        <div className="aviso forte" style={{ marginBottom: 'var(--e6)' }}>
          <strong>
            O caso passou de {c.max_chars_caso.toLocaleString('pt-BR')} caracteres e foi cortado.
          </strong>{' '}
          O que ficou de fora não foi analisado.
        </div>
      )}

      {(rodando || parado || vivo.logs.length > 0 || !!vivo.erro) && (
        <section className="secao">
          <PipelineAoVivo vivo={vivo} />
          {/* `erro` é tão retomável quanto `interrompido`: o servidor publica
              retomavel:true nos dois (api/execucao.py) e aceita o POST nos
              dois. Só `interrompido` aqui deixava o botão depender de um
              evento SSE reproduzido para aparecer. */}
          {(parado || vivo.retomavel) && (
            <p className="aviso forte" style={{ marginTop: 'var(--e4)' }}>
              {c.erro ?? vivo.erro}
              <br />
              O que já rodou está no checkpoint — retomar não repaga o que foi pago.{' '}
              <button
                type="button"
                className="leve"
                disabled={retomando || rodando}
                onClick={async () => {
                  setRetomando(true)
                  try {
                    await post(`/api/consultas/${c.thread}/retomar`)
                    qc.invalidateQueries({ queryKey: ['consulta', thread] })
                  } finally {
                    setRetomando(false)
                  }
                }}
              >
                {retomando ? 'retomando…' : 'retomar de onde parou'}
              </button>
            </p>
          )}
        </section>
      )}

      <nav className="abas nao-imprime">
        {ABAS.map(([id, rotulo]) => (
          <NavLink
            key={id}
            to={id === 'evidencias' ? `/consulta/${c.thread}` : `/consulta/${c.thread}/${id}`}
            end
            className={({ isActive }) => (isActive ? 'ativo' : '')}
          >
            {rotulo}
            {id === 'evidencias' && ` (${c.precedentes.length})`}
          </NavLink>
        ))}
      </nav>

      {aba === 'evidencias' && <Evidencias c={c} />}
      {aba === 'prognostico' && <Prognostico c={c} />}
      {aba === 'minuta' && <Minuta c={c} />}
      {aba === 'pesos' && <AbaPesos thread={c.thread} />}
      {aba === 'rede' && <AbaRede thread={c.thread} />}
      {aba === 'custo' && <AbaCusto c={c} />}
    </>
  )
}

// ------------------------------------------------------------ evidências

function Evidencias({ c }: { c: C }) {
  const qc = useQueryClient()
  const { data: av } = useQuery({
    queryKey: ['avaliacao', c.thread],
    queryFn: () =>
      get<{ vereditos: Record<string, string | null>; humano: any; juiz: any; concordancia: any }>(
        `/api/consultas/${c.thread}/avaliacao`,
      ),
  })

  const marcar = async (id: number, v: 'util' | 'inutil' | null) => {
    await post(`/api/consultas/${c.thread}/precedentes/${id}/veredito`, { veredito: v })
    qc.invalidateQueries({ queryKey: ['avaliacao', c.thread] })
  }

  return (
    <>
      <section className="secao">
        <h2>Leitura do caso</h2>
        <div className="painel">
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--e2) var(--e6)' }}>
            {[
              ['Classe', c.triagem.classe],
              ['Matéria', c.triagem.materia],
              ['Tese', c.triagem.tese],
              ['Pedidos', (c.triagem.pedidos ?? []).join('; ')],
            ].map(([k, v]) => (
              <div key={k as string} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 3 }}>
                  {k}
                </dt>
                <dd style={{ margin: 0 }}>{(v as string) || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
        {c.consulta_fts && (
          <p style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-xs)', marginTop: 'var(--e2)' }}>
            busca FTS5: <code>{c.consulta_fts}</code> · {c.n_candidatos} candidatos do BM25,{' '}
            {c.precedentes.length} aprovados na triagem
          </p>
        )}
      </section>

      <section className="secao">
        <h2>Precedentes usados</h2>
        <p className="nota">
          {c.tese === 'neutra' ? (
            <>São estes que produziram o prognóstico.</>
          ) : (
            <>
              São os que a triagem leu e considerou capazes de sustentar o lado que você pediu.
              Por isso <b>não</b> há prognóstico nesta consulta.
            </>
          )}{' '}
          Marcar “não serviu” faz o precedente perder posição nas próximas buscas — o ajuste é
          limitado a ±30%, porque o BM25 foi calibrado em 400 casos cegos e um clique não vale
          mais que isso.
        </p>
        {c.precedentes.map((p) => (
          <Precedente
            key={p.id}
            p={p}
            veredito={av?.vereditos?.[p.id]}
            onVeredito={(v) => marcar(p.id, v)}
          />
        ))}
        {c.precedentes.length === 0 && (
          <p className="vazio">Nenhum precedente com analogia suficiente foi encontrado.</p>
        )}
      </section>

      <LinhaDeArgumentacao c={c} />
      <Procedencia c={c} />
    </>
  )
}

const ROTULO_TESE: Record<string, string> = {
  reformar: 'REFORMAR (dar provimento)',
  manter: 'MANTER (negar provimento)',
}

/**
 * O que a triagem descartou para chegar nos precedentes acima. É a evidência
 * que o modo tese produz de novo: quantos análogos decidem CONTRA o lado
 * pedido. Um `reformar` que descarta 63 e acha 3 está dizendo alguma coisa.
 */
function LinhaDeArgumentacao({ c }: { c: C }) {
  if (!ROTULO_TESE[c.tese]) return null
  const d = c.descartados ?? {}
  const cm = c.comuns ?? {}
  const grupos: [string, [string, number][] | undefined][] = [
    ['Âncoras citadas por mais de um', cm.ancoras],
    ['Câmaras', cm.orgaos],
    ['Classes', cm.classes],
  ]

  return (
    <section className="secao">
      <h2>Linha de argumentação: {ROTULO_TESE[c.tese]}</h2>
      <p className="aviso forte">
        Os {c.precedentes.length} precedentes acima <b>não são uma amostra</b> — são o que sobrou
        depois de a triagem ler cada candidato e manter só os que sustentam este lado.
        Descartados: <b>{d.contra ?? 0}</b> que decidem contra e <b>{d.neutro ?? 0}</b> neutros.
      </p>
      <p className="nota">
        O corte é semântico, não pelo rótulo <code>provido</code>/<code>desprovido</code>: esse
        rótulo só diz que o <b>recorrente daquele processo</b> venceu, e o recorrente de lá pode
        ser a parte contrária à sua. Um acórdão “provido” em que quem recorreu foi a seguradora é
        material contra um segurado.
      </p>

      {c.precedentes.length === 0 ? (
        <p className="aviso forte">
          A triagem não achou precedente que sustente este lado. Isso é um achado, não uma falha:
          no acervo deste relator, com estes termos de busca, não há material para essa linha.
          Rode em modo neutro para ver o que existe.
        </p>
      ) : (
        cm.n && (
          <>
            <h3>O que se repete entre eles</h3>
            <ul>
              {grupos.map(([rotulo, vs]) =>
                vs && vs.length > 0 ? (
                  <li key={rotulo}>
                    <b>{rotulo}:</b> {vs.map(([v, n]) => `${v} (${n})`).join('; ')}
                  </li>
                ) : null,
              )}
              <li>
                <b>
                  {cm.unanimes} de {cm.n} unânimes
                </b>
                , {cm.transitaram} transitaram em julgado
                {cm.anos && cm.anos.length > 0 && (
                  <>
                    , anos {cm.anos[0]}–{cm.anos[cm.anos.length - 1]}
                  </>
                )}
              </li>
            </ul>
            {(!cm.ancoras || cm.ancoras.length === 0) && (
              <p className="nota">
                Nenhuma âncora aparece em mais de um deles: são decisões que chegaram ao mesmo
                resultado por caminhos diferentes. O ponto comum, se existir, está nos fatos — não
                há tese única para citar.
              </p>
            )}
          </>
        )
      )}
    </section>
  )
}

function Procedencia({ c }: { c: C }) {
  const p = c.perfil ?? {}
  const contra = c.contra ?? {}
  if (!p.usos) return null
  const grupos: [string, [string, number][]][] = [
    ['Em que classes', p.por_classe],
    ['Por qual câmara', p.por_orgao],
    ['De que comarcas', p.por_comarca],
  ]

  return (
    <section className="secao">
      <h2>Procedência do argumento</h2>
      <p className="nota">
        Contagem sobre o acervo inteiro, sem IA. É fato, não opinião do modelo.
      </p>

      <div className="faixa" style={{ marginBottom: 'var(--e4)' }}>
        <div className="medida">
          <dt>usado em</dt>
          <dd>
            {p.usos.toLocaleString('pt-BR')}
            <small> decisões de mérito</small>
          </dd>
        </div>
        <div className="medida">
          <dt>período</dt>
          <dd>
            {p.primeiro_ano}–{p.ultimo_ano}
          </dd>
        </div>
        <div className="medida">
          <dt>reforma em</dt>
          <dd>{pct(p.reforma_pct, 1)}</dd>
        </div>
        <div className="medida">
          <dt>com âncora nacional</dt>
          <dd>
            {p.com_ancora_nacional}
            <small> ({pct((100 * p.com_ancora_nacional) / p.usos)})</small>
          </dd>
        </div>
      </div>

      {grupos.map(
        ([rotulo, lista]) =>
          lista?.length > 0 && (
            <p key={rotulo} className="prec-linha">
              <b>{rotulo}</b>
              {lista.slice(0, 4).map(([v, n]) => `${v} (${n})`).join('; ')}
            </p>
          ),
      )}

      <p className="aviso" style={{ marginTop: 'var(--e4)' }}>
        “Por quem” aqui significa <b>qual câmara</b> — o acervo é de um relator só. E “em quais
        estados” não é respondível com estes dados: o acervo é 100% TJSC. Um argumento ancorado
        em tema repetitivo do STJ vincula todo o país; um ancorado só na própria câmara não diz
        nada sobre os outros tribunais.
      </p>

      <h3 style={{ margin: 'var(--e8) 0 var(--e2)', fontSize: 'var(--t-md)' }}>
        Já existe contra-argumentação?
      </h3>
      {contra.empate ? (
        <p>
          <b>Empate.</b> Os {contra.de} precedentes de mérito se dividem metade a metade. Não há
          tendência a extrair daqui — o caso está na fronteira.
        </p>
      ) : contra.contra > 0 ? (
        <p>
          <b>Sim.</b> {contra.contra} dos {contra.de} precedentes decidiram para o lado oposto ao
          majoritário ({contra.lado_majoritario}):{' '}
          {(contra.exemplos ?? []).map((e: any) => e.numero).join(', ')}.
        </p>
      ) : (
        <p>
          Nenhum dos precedentes recuperados decidiu para o lado oposto. Isso é ausência de
          divergência <b>nesta busca</b>, não prova de que não exista.
        </p>
      )}
      {p.nao_unanimes > 0 && (
        <p className="prec-linha">
          No acervo inteiro, <b>{p.nao_unanimes}</b> decisões com esse argumento não foram
          unânimes — sustentação mais frágil.
        </p>
      )}
    </section>
  )
}

// ------------------------------------------------------------ prognóstico

function Prognostico({ c }: { c: C }) {
  const p = c.prognostico
  const qc = useQueryClient()
  const { data: av } = useQuery({
    queryKey: ['avaliacao', c.thread],
    queryFn: () => get<any>(`/api/consultas/${c.thread}/avaliacao`),
  })
  const [nota, setNota] = useState<string>('')
  const [comentario, setComentario] = useState('')

  if (!p || Object.keys(p).length === 0)
    return <p className="vazio">O prognóstico ainda não foi calculado.</p>

  return (
    <>
      <section className="secao">
        {p.enviesado ? (
          <>
            <h2 style={{ color: 'var(--alerta)', fontSize: 'var(--t-xl)' }}>
              SEM PROGNÓSTICO — você pediu um lado
            </h2>
            <p className="nota">
              Os precedentes foram escolhidos por sustentarem a linha que você pediu. Qualquer
              percentual tirado deles mediria a própria escolha.
            </p>
            <p className="aviso forte">
              Para o número calibrado, rode a mesma consulta em <b>modo neutro</b> — é a única em
              que a amostra não foi escolhida por você.
            </p>
            {p.floresta && (
              <p className="aviso">
                Único estimador que sobrevive: a <b>floresta</b> aponta{' '}
                {pct(100 * p.floresta.p_reforma)} de chance de reforma. Ela lê o caso, não a
                busca, então o filtro não a contamina — mas sai <b>crua</b>: a calibração foi
                ajustada sobre a escala do conjunto, que aqui não existe. Ordena, não é
                probabilidade.
              </p>
            )}
          </>
        ) : p.decide === false ? (
          <>
            <h2 style={{ color: 'var(--alerta)', fontSize: 'var(--t-xl)' }}>NÃO DECIDO</h2>
            <p className="nota">Os dados não sustentam um prognóstico neste caso:</p>
            <ul>
              {(p.confianca?.por_que ?? []).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
            <p className="aviso forte">
              Nesta faixa o sistema acerta ~70%, contra ~96,7% quando a estimativa é firme. Um
              número aqui seria um palpite com cara de medição. <b>As evidências continuam
              válidas</b> — é com elas que se decide, não com o percentual.
            </p>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 'var(--t-xxl)', fontFamily: 'var(--fonte-serif)' }}>
              {pct(p.probabilidade_pct)} de chance de reforma
            </h2>
            <p className="nota">
              {p.intervalo_pct &&
                `intervalo de 80%: ${pct(p.intervalo_pct[0])} a ${pct(p.intervalo_pct[1])} · `}
              resultado mais provável: <b>{p.resultado_provavel}</b>
            </p>
            <p className="aviso">
              {p.calibrado
                ? 'Percentual calibrado: entre os casos em que o sistema diz um número, essa é a fração que de fato reformou. Aferido em 1.092 decisões de 2025 que não entraram no ajuste — erro máximo de 5 pontos.'
                : 'Sem calibrador treinado: este número ordena bem, mas não é uma probabilidade.'}
            </p>
          </>
        )}
      </section>

      {p.distribuicao && p.distribuicao.length > 0 && (
        <section className="secao">
          <h2>Peso dos precedentes por resultado</h2>
          <table style={{ maxWidth: 420 }}>
            <thead>
              <tr>
                <th>resultado</th>
                <th className="num">peso</th>
              </tr>
            </thead>
            <tbody>
              {p.distribuicao.map(([r, w]) => (
                <tr key={r}>
                  <td>{r}</td>
                  <td className="num">{pct(w, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* no modo tese a floresta já saiu sozinha lá em cima, e o k-NN nem existe */}
      {!p.enviesado && (
      <section className="secao">
        <h2>Dois estimadores</h2>
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>estimador</th>
                <th className="num">P(reforma)</th>
                <th>o que é</th>
              </tr>
            </thead>
            <tbody>
              {p.reforma_nos_precedentes != null && (
                <tr>
                  <td>k-NN sobre precedentes</td>
                  <td className="num">{pct(p.reforma_nos_precedentes, 1)}</td>
                  <td>auditável: sai dos {p.n_precedentes} precedentes listados</td>
                </tr>
              )}
              {p.floresta && (
                <tr>
                  <td>Random Forest</td>
                  <td className="num">{pct(100 * p.floresta.p_reforma, 1)}</td>
                  <td>
                    opaco: treinado em {p.floresta.n_treino?.toLocaleString('pt-BR')} decisões até{' '}
                    {p.floresta.treinado_ate}, não olha os precedentes
                  </td>
                </tr>
              )}
              {p.reforma_conjunta_pct != null && (
                <tr>
                  <td>
                    <b>conjunto</b>
                  </td>
                  <td className="num">
                    <b>{pct(p.reforma_conjunta_pct, 1)}</b>
                  </td>
                  <td>média ponderada (fonte: {p.fonte})</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {p.acordo === false && <p className="aviso forte">{p.divergencia}</p>}
        {p.acordo === true && <p className="nota">Os dois estimadores concordam no lado.</p>}
        {p.fonte === 'floresta (sem precedente)' && (
          <p className="aviso forte">
            A busca não trouxe precedente análogo. O número vem <b>só</b> do modelo estatístico,
            que é o estimador mais fraco dos dois (precisão de 39% medida isoladamente). Trate
            como indicação, não como prognóstico.
          </p>
        )}
        {p.reforma_historica_classe != null && (
          <p className="nota" style={{ marginTop: 'var(--e4)' }}>
            Base histórica de {p.classe_base} ({p.n_classe?.toLocaleString('pt-BR')} decisões de
            mérito): <b>{pct(p.reforma_historica_classe, 1)}</b> de reforma. Só como ordem de
            grandeza — a deriva entre anos é de ~11 pontos, então a média de duas décadas não
            descreve o tribunal de hoje.
          </p>
        )}
      </section>
      )}

      <section className="secao nao-imprime">
        <h2>Sua avaliação</h2>
        <p className="nota">
          A nota serve para medir se o juiz automático concorda com você. Sem isso, o bench de
          modelos não vale nada.
          {av?.concordancia?.n >= 2 &&
            ` Até aqui: ${av.concordancia.n} pares, erro médio ${av.concordancia.erro_medio}, correlação ${av.concordancia.correlacao ?? '—'}.`}
        </p>
        {av?.juiz && (
          <p className="prec-linha">
            <b>Juiz automático</b>
            {av.juiz.nota?.toFixed(1)} — {av.juiz.detalhe?.juiz}
            {av.juiz.detalhe?.modo === 'sem_referencia' &&
              ' (sem gabarito: mede coerência e fidelidade, não se está juridicamente certo)'}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--e3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="campo" style={{ width: 110, marginBottom: 0 }}>
            <span>nota 0–5</span>
            <input
              type="number"
              min={0}
              max={5}
              step={0.5}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder={av?.humano?.nota != null ? String(av.humano.nota) : '—'}
            />
          </label>
          <label className="campo" style={{ flex: '1 1 300px', marginBottom: 0 }}>
            <span>comentário</span>
            <input
              type="text"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder={av?.humano?.detalhe?.comentario ?? ''}
            />
          </label>
          <button
            type="button"
            className="botao"
            disabled={nota === ''}
            onClick={async () => {
              await post(`/api/consultas/${c.thread}/avaliacao`, {
                nota: Number(nota),
                comentario,
              })
              qc.invalidateQueries({ queryKey: ['avaliacao', c.thread] })
              qc.invalidateQueries({ queryKey: ['consultas'] })
            }}
          >
            registrar
          </button>
        </div>
      </section>
    </>
  )
}

// ---------------------------------------------------------------- minuta

function Minuta({ c }: { c: C }) {
  if (!c.minuta) return <p className="vazio">Esta consulta parou antes de redigir a minuta.</p>
  return (
    <>
      {c.prognostico.decide === false && (
        <p className="aviso forte">
          Escrita sob a instrução de <b>não afirmar um desfecho como provável</b>: ela expõe os
          dois caminhos e o ponto concreto de que o caso depende.
        </p>
      )}
      {(c.prognostico.revisao_problemas ?? []).length > 0 && (
        <section className="secao">
          <h2>Ressalvas do revisor, não corrigidas</h2>
          <p className="nota">
            O revisor é de outro fornecedor que o redator, de propósito: crítica independente é o
            ponto do arranjo multi-agente.
          </p>
          <ul>
            {c.prognostico.revisao_problemas!.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="secao">
        <Markdown texto={c.minuta} />
      </section>
      {c.julgamento?.notas && (
        <section className="secao">
          <h2>Nota do juiz automático — {c.julgamento.media}</h2>
          <p className="nota">{c.julgamento.juiz}</p>
          <table style={{ maxWidth: 420 }}>
            <thead>
              <tr>
                <th>critério</th>
                <th className="num">0–5</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(c.julgamento.notas).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.julgamento.resumo && <p className="aviso">{c.julgamento.resumo}</p>}
        </section>
      )}
    </>
  )
}

// ----------------------------------------------------------- pesos e rede

function AbaPesos({ thread }: { thread: string }) {
  const { data } = useQuery({
    queryKey: ['pesos', thread],
    queryFn: () => get<Pesos>(`/api/consultas/${thread}/pesos`),
  })
  const { data: cal } = useQuery({
    queryKey: ['calibracao'],
    queryFn: () => get<any>('/api/estatisticas/calibracao'),
    staleTime: Infinity,
  })
  if (!data) return <p className="vazio">carregando…</p>
  return (
    <>
      <PainelPesos p={data} />
      {cal?.tem_curva && (
        <section className="secao">
          <h2>A escala mente?</h2>
          <p className="nota">
            Curva de confiabilidade medida em {cal.ano_validacao}, fora do ajuste. Quanto mais
            perto da diagonal, mais o percentual quer dizer o que diz.
          </p>
          <Confiabilidade curva={cal.curva_depois} />
        </section>
      )}
    </>
  )
}

function AbaRede({ thread }: { thread: string }) {
  const { data } = useQuery({
    queryKey: ['rede', thread],
    queryFn: () => get<Rede>(`/api/consultas/${thread}/rede`),
  })
  if (!data) return <p className="vazio">carregando…</p>
  return (
    <section className="secao">
      <h2>Rede de precedentes</h2>
      <p className="nota">
        As caixas são âncoras — súmulas, temas repetitivos, IRDR — citadas por duas ou mais
        decisões. Traço cheio liga uma decisão à âncora em que ela se apoia; tracejado liga
        ementas parecidas, que é pista, não argumento. Clique num círculo para abrir a decisão.
      </p>
      <RedePrecedentes r={data} />
    </section>
  )
}

function AbaCusto({ c }: { c: C }) {
  return (
    <section className="secao">
      <h2>Custo e rastro</h2>
      <p className="nota">
        O custo não é estimado por tabela de preços: o OpenRouter devolve o valor real de cada
        chamada, então a conta bate mesmo quando o modelo cai para outro provedor.
      </p>
      <div className="tabela-rolavel">
        <table>
          <thead>
            <tr>
              <th>nó</th>
              <th>modelo</th>
              <th className="num">tokens in</th>
              <th className="num">tokens out</th>
              <th className="num">US$</th>
            </tr>
          </thead>
          <tbody>
            {c.custos.map((x, i) => (
              <tr key={i}>
                <td>
                  {x.no}
                  {x.cortado && <span className="selo alerta"> cortado no teto</span>}
                </td>
                <td className="mono">{x.modelo}</td>
                <td className="num">{x.tokens_in.toLocaleString('pt-BR')}</td>
                <td className="num">{x.tokens_out.toLocaleString('pt-BR')}</td>
                <td className="num">{x.custo_usd.toFixed(4)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4}>
                <b>total</b>
              </td>
              <td className="num">
                <b>{c.custo_total.toFixed(4)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="nota" style={{ marginTop: 'var(--e4)' }}>
        {c.n_candidatos} candidatos do BM25, {c.precedentes.length} aprovados na triagem
        {c.segundos != null && `, ${Math.round(c.segundos)}s`}.
      </p>
    </section>
  )
}
