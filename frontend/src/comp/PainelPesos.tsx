import type { Pesos } from '../api'
import { pct } from '../hooks'

const CORES = ['#2f4a3f', '#7a5c3e', '#3e5566', '#a8875c', '#55504a', '#8a8378', '#4a6b5c', '#9a958c']

const n2 = (v: number) => v.toFixed(2)

/**
 * Todo multiplicador que produziu o prognóstico, com o número na tela.
 *
 * O relatório em markdown já dizia "1.42x". O que ele não dizia é de onde vêm os
 * fatores, nem quanto cada precedente pesou no total — e é exatamente isso que
 * um advogado precisa para conferir, ou para discordar com fundamento.
 */
export function PainelPesos({ p }: { p: Pesos }) {
  const a = p.agregacao
  const escala = (v: number | null | undefined) => (v == null ? null : Math.max(0, Math.min(100, v)))

  const pontos = [
    { rotulo: 'k-NN', v: escala(a.knn), titulo: 'sobre os precedentes listados — auditável' },
    { rotulo: 'floresta', v: escala(a.floresta), titulo: 'Random Forest — não olha os precedentes' },
    { rotulo: 'conjunto', v: escala(a.conjunto), titulo: `média ponderada (peso k-NN ${p.config.peso_knn})` },
    { rotulo: 'calibrado', v: escala(a.calibrado), titulo: 'escala corrigida pela isotônica', destaque: true },
  ].filter((x) => x.v != null) as { rotulo: string; v: number; titulo: string; destaque?: boolean }[]

  const corte = (p.config.confianca?.corte_margem ?? 0.35) * 100

  return (
    <>
      <section className="secao">
        <h2>Os dois estimadores, num eixo só</h2>
        <p className="nota">
          Zero é manter a decisão de origem; cem é reformar. A faixa hachurada é onde o
          sistema se recusa a cravar — margem menor que {corte.toFixed(0)} pontos do meio.
          Não é falha: nessa faixa ele acerta ~70%, contra ~96% fora dela.
        </p>

        <div className="eixo-estimadores">
          <div className="hachura" style={{ left: `${50 - corte}%`, width: `${2 * corte}%` }} />
          {a.intervalo && (
            <div
              className="faixa-intervalo"
              style={{ left: `${a.intervalo[0]}%`, width: `${a.intervalo[1] - a.intervalo[0]}%` }}
              title={`intervalo de 80%: ${pct(a.intervalo[0])} a ${pct(a.intervalo[1])}`}
            />
          )}
          <div className="regua" />
          {[0, 25, 50, 75, 100].map((t) => (
            <span className="tick" key={t} style={{ left: `${t}%` }}>
              {t}%
            </span>
          ))}
          {pontos.map((x, i) => (
            <span
              key={x.rotulo}
              className={`ponto${x.destaque ? ' destaque' : ''}`}
              style={{ left: `${x.v}%`, top: i % 2 ? 0 : 14 }}
              title={x.titulo}
            >
              {x.rotulo} {pct(x.v, 1)}
              <i />
            </span>
          ))}
        </div>

        {a.acordo === false && (
          <p className="aviso forte">
            Os dois estimadores discordam. Isso não é defeito a ignorar: é o sinal de que o
            caso está na fronteira, e a minuta foi instruída a enfrentar os dois lados.
          </p>
        )}
        {a.decide === false && (
          <div className="aviso forte">
            <strong>NÃO DECIDO.</strong>
            <ul>
              {(a.confianca?.por_que ?? []).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {!p.config.calibrado && (
          <p className="aviso">
            Sem calibrador treinado: o número ordena bem, mas não é probabilidade. Rode{' '}
            <code>python -m src.rag.calibrar --ajustar</code>.
          </p>
        )}
      </section>

      <section className="secao">
        <h2>Quanto cada precedente pesou</h2>
        <p className="nota">
          A largura é a fração do peso total. Passe o mouse para ver o número.
        </p>
        <div className="barra-fracao">
          {p.precedentes.map((l, i) => (
            <div
              key={l.id}
              style={{ width: `${l.fracao_do_total * 100}%`, background: CORES[i % CORES.length] }}
              title={`${l.numero} — ${pct(l.fracao_do_total * 100, 1)} do peso`}
            >
              {l.fracao_do_total > 0.07 ? pct(l.fracao_do_total * 100) : ''}
            </div>
          ))}
        </div>
      </section>

      <section className="secao">
        <h2>De onde sai cada peso</h2>
        <p className="nota">
          A conta é <code>|BM25| × fatores da ficha = pontos</code>, e depois{' '}
          <code>pontos × peso da confiança × (analogia ÷ 5) = peso final</code>. Nenhum
          fator aqui inventa relevância — todos modulam o que o BM25 já achou.
        </p>

        {p.precedentes.map((l, i) => (
          <div className="prec" key={l.id}>
            <div className="prec-topo">
              <span className="prec-numero">{l.numero}</span>
              <span className="selo" style={{ borderColor: CORES[i % CORES.length], color: CORES[i % CORES.length] }}>
                {pct(l.fracao_do_total * 100, 1)} do peso
              </span>
              <span className="prec-meta">
                {l.resultado} · {l.ano}
              </span>
            </div>

            <div className="cascata">
              <span className="parcela" title={`BM25 bruto ${l.bm25?.toFixed(2)}`}>
                |BM25| {n2(l.base)}
              </span>
              {Object.entries(l.fatores).length === 0 && (
                <span className="op">sem ajuste de ranking</span>
              )}
              {Object.entries(l.fatores).map(([nome, v]) => (
                <span key={nome}>
                  <span className="op">×</span>{' '}
                  <span className={`parcela ${v >= 1 ? 'sobe' : 'desce'}`}>
                    {nome} {n2(v)}
                  </span>
                </span>
              ))}
              <span className="op">=</span>
              <span className="parcela igual">pontos {n2(l.pontos ?? 0)}</span>
            </div>

            <div className="cascata" style={{ marginTop: 'var(--e2)' }}>
              <span className="parcela">pontos {n2(l.pontos ?? 0)}</span>
              <span className="op">×</span>
              <span className="parcela" title={`classificação do resultado: ${l.rotulo_confianca}`}>
                confiança {n2(l.peso_confianca)}
              </span>
              <span className="op">×</span>
              <span className="parcela" title={`analogia ${l.nota}/5`}>
                analogia {n2(l.nota_norm)}
              </span>
              <span className="op">=</span>
              <span className="parcela igual">peso {n2(l.peso_final)}</span>
            </div>
          </div>
        ))}

        {p.precedentes.length === 0 && (
          <p className="vazio">
            Nenhum precedente entrou no prognóstico — não há peso a mostrar.
          </p>
        )}
      </section>

      <section className="secao">
        <h2>Os multiplicadores em vigor</h2>
        <p className="nota">
          Do <code>config_rag.json</code> carregado neste processo. Mudar o arquivo com o
          servidor de pé não muda nada até reiniciar.
        </p>
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>fator</th>
                <th className="num">valor</th>
                <th>o que faz</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>meia-vida da idade</td>
                <td className="num">{p.config.rerank.meia_vida_anos} anos</td>
                <td>decisão dessa idade vale metade de uma de hoje</td>
              </tr>
              <tr>
                <td>piso de recência</td>
                <td className="num">{p.config.rerank.piso_recencia}</td>
                <td>lei velha ainda é lei: nunca zera</td>
              </tr>
              {Object.entries(p.config.rerank.ancora ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <td>âncora {k}</td>
                  <td className="num">{String(v)}</td>
                  <td>
                    {k === 'vinculante'
                      ? 'obriga todo o país (tema, IRDR, súmula vinculante)'
                      : k === 'persuasiva'
                        ? 'convence (súmula, STJ/STF)'
                        : 'orientação da própria câmara'}
                  </td>
                </tr>
              ))}
              <tr>
                <td>não unânime</td>
                <td className="num">{p.config.rerank.nao_unanime}</td>
                <td>voto vencido: sustentação mais frágil</td>
              </tr>
              <tr>
                <td>transitou em julgado</td>
                <td className="num">{p.config.rerank.transitou}</td>
                <td>ninguém levou adiante — a tese se sustentou</td>
              </tr>
              <tr>
                <td>subiu sem trânsito</td>
                <td className="num">{p.config.rerank.subiu_sem_transito}</td>
                <td>foi para STJ/STF: tese contestada</td>
              </tr>
              <tr>
                <td>sobrestado</td>
                <td className="num">{p.config.rerank.sobrestado}</td>
                <td>controvérsia nacional em aberto</td>
              </tr>
              {Object.entries(p.config.peso_confianca).map(([k, v]) => (
                <tr key={k}>
                  <td>confiança “{k}”</td>
                  <td className="num">{v}</td>
                  <td>de onde o classificador leu o resultado</td>
                </tr>
              ))}
              <tr>
                <td>peso do k-NN no conjunto</td>
                <td className="num">{p.config.peso_knn}</td>
                <td>o resto vai para a floresta</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
