import { useEffect, useRef, useState } from 'react'

/** A cascata inteira do prognóstico, como `api/serial.pesos` a devolve.
 *
 *  Nada aqui é recalculado: `apresentacao/montar.py` congela o retorno daquela
 *  função — a MESMA que serve a aba Pesos do produto — e este componente só
 *  revela o que já está calculado, um pedaço por vez. Refazer a conta em
 *  TypeScript para poder animá-la seria manter duas aritméticas do mesmo
 *  número, e o dia em que divergissem a tela mentiria sem avisar. */
export type Pesos = {
  config: {
    peso_confianca: Record<string, number>
    peso_knn: number
    confianca: {
      corte_margem: number
      min_precedentes: number
      concordancia_minima: number
      desacordo_maximo: number
      reamostragens: number
    }
    calibrado: boolean
  }
  precedentes: {
    numero: string
    resultado: string
    ano: number
    pontos: number
    peso_confianca: number
    rotulo_confianca: string
    nota: number
    nota_norm: number
    peso_final: number
    fracao_do_total: number
  }[]
  agregacao: {
    knn: number | null
    floresta: number | null
    conjunto: number | null
    calibrado: number | null
    intervalo: [number, number] | null
    fonte: string
    acordo: boolean | null
    decide: boolean
    confianca: {
      margem?: number
      concordancia?: number
      desacordo?: number
      n_precedentes?: number
      por_que?: string[]
    }
  }
}

const MERITO = ['provido', 'parcialmente provido', 'desprovido']
const REFORMA = ['provido', 'parcialmente provido']

const um = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`)

/** Quanto tempo cada batida fica em cena. Não é o tempo que o sistema levou —
 *  o prognóstico inteiro é aritmética, roda em milissegundos e não teria o que
 *  assistir. É tempo de LEITURA, e a tela diz isso em vez de fingir cronômetro. */
const BATIDA = 460

export function ContaAoVivo({ p }: { p: Pesos }) {
  const prec = p.precedentes
  const total = prec.length + 5
  const [n, defN] = useState(0)
  /** o precedente cuja linha a pessoa abriu. A tabela mostra a conta; a
   *  ficha mostra de onde cada fator dela saiu. */
  const [sel, defSel] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Partida: entrar em vista uma vez. Quem avança é o efeito abaixo, e não uma
  // recursão de setTimeout presa dentro deste — foi o que fez o botão "de novo"
  // não funcionar na primeira versão: zerar o contador não reacendia uma cadeia
  // que já tinha terminado.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      defN(total)
      return
    }
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return
      obs.disconnect()
      defN(1)
    }, { threshold: 0.25 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [total])

  // SEM rede de tempo aqui, e é decisão, não esquecimento. O contador da capa
  // tem uma porque ele anda com requestAnimationFrame, que PARA de verdade em
  // aba de segundo plano — e um número travado em zero seria resposta errada.
  // Esta conta anda com setTimeout, que em aba escondida é afunilado para ~1/s
  // mas não para: a sequência termina de todo jeito. A primeira versão copiou a
  // rede assim mesmo, com 4 segundos a partir da montagem — e como a seção fica
  // bem abaixo da dobra, o estouro chegava antes de qualquer pessoa rolar até
  // ela: a conta já estava toda acesa quando entrava em cena, e a animação
  // simplesmente nunca rodava.

  // O avanço: uma batida por vez enquanto houver conta para revelar.
  useEffect(() => {
    if (n < 1 || n >= total) return
    const t = setTimeout(() => defN(n + 1), BATIDA)
    return () => clearTimeout(t)
  }, [n, total])

  const visiveis = Math.min(n, prec.length)
  const lidas = prec.slice(0, visiveis)
  // o acumulador é a conta de verdade, parcial: soma de peso dos que reformaram
  // sobre soma de peso dos de mérito, exatamente como em src/rag/grafo.py
  let merito = 0
  let reforma = 0
  for (const l of lidas) {
    if (!MERITO.includes(l.resultado)) continue
    merito += l.peso_final
    if (REFORMA.includes(l.resultado)) reforma += l.peso_final
  }
  const parcial = merito ? (100 * reforma) / merito : null
  const fim = visiveis === prec.length

  const aberta = sel ? prec.find((x) => x.numero === sel) : undefined

  const g = p.agregacao
  const c = p.config.confianca
  const conf = g.confianca ?? {}
  const largura = g.intervalo ? (g.intervalo[1] - g.intervalo[0]) / 100 : null
  const cortes = [
    { rot: 'margem |p − 50%|', v: conf.margem, corte: c.corte_margem, min: true },
    { rot: 'precedentes análogos', v: conf.n_precedentes, corte: c.min_precedentes, min: true },
    { rot: 'concordância entre eles', v: conf.concordancia, corte: c.concordancia_minima, min: true },
    { rot: 'desacordo k-NN × floresta', v: conf.desacordo, corte: c.desacordo_maximo, min: false },
    { rot: 'largura do intervalo', v: largura, corte: 0.6, min: false },
  ]

  return (
    <div className="apr-conta" ref={ref}>
      <div className="apr-tabela">
        <table>
          <caption className="apr-formula">
            peso = confiança no resultado × (analogia ÷ 5) × pontos do rerank
          </caption>
          <thead>
            <tr>
              <th>Precedente</th>
              <th>Resultado</th>
              <th className="num">Confiança</th>
              <th className="num">Analogia</th>
              <th className="num">Pontos</th>
              <th className="num">Peso</th>
              <th className="num">Reforma acumulada</th>
            </tr>
          </thead>
          <tbody>
            {prec.map((l, i) => {
              const acesa = i < visiveis
              const ate = prec.slice(0, i + 1)
              let m = 0
              let r = 0
              for (const x of ate) {
                if (!MERITO.includes(x.resultado)) continue
                m += x.peso_final
                if (REFORMA.includes(x.resultado)) r += x.peso_final
              }
              return (
                <tr key={l.numero}
                  className={`apr-linha-conta clicavel${acesa ? ' acesa' : ''}`
                    + `${sel === l.numero ? ' sel' : ''}`}
                  tabIndex={0}
                  onClick={() => defSel(sel === l.numero ? null : l.numero)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    defSel(sel === l.numero ? null : l.numero)
                  }}>
                  <td>{l.numero}</td>
                  <td className={REFORMA.includes(l.resultado) ? 'destaque' : undefined}>
                    {l.resultado}
                  </td>
                  <td className="num" title={l.rotulo_confianca}>
                    {l.peso_confianca.toFixed(1)}×
                  </td>
                  <td className="num">{l.nota}/5</td>
                  <td className="num">{l.pontos.toFixed(2)}</td>
                  <td className="num">{l.peso_final.toFixed(2)}</td>
                  <td className="num destaque">
                    {acesa && m ? `${((100 * r) / m).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {aberta && (
        <div className="apr-conta-ficha">
          <span className="rot">{aberta.numero} · {aberta.ano}</span>
          <p>
            Este precedente entrou com{' '}
            <strong>{aberta.pontos.toFixed(2)} pontos</strong> do rerank, nota de analogia{' '}
            <strong>{aberta.nota}/5</strong> e confiança{' '}
            <strong>{aberta.peso_confianca.toFixed(1)}×</strong> — o resultado dele foi lido{' '}
            {aberta.rotulo_confianca === 'dispositivo'
              ? 'direto no dispositivo, que é a leitura firme'
              : `de ${aberta.rotulo_confianca}, que é leitura menos firme e por isso pesa menos`}.
          </p>
          <p className="apr-formula-linha">
            {aberta.peso_confianca.toFixed(1)} × {aberta.nota_norm.toFixed(2)} ×{' '}
            {aberta.pontos.toFixed(2)} = <b>{aberta.peso_final.toFixed(2)}</b>
          </p>
          <p>
            Sozinho, ele responde por{' '}
            <strong>{(100 * aberta.fracao_do_total).toFixed(1)}%</strong> do prognóstico, e o
            resultado que ele carrega para a conta é <strong>{aberta.resultado}</strong>.
            {aberta.fracao_do_total > 0.3 && ' Um único acórdão sustentando mais de um terço '
              + 'da conclusão é coisa para conferir antes de citar.'}
          </p>
          <button className="apr-sair" onClick={() => defSel(null)}>fechar</button>
        </div>
      )}

      <p className="apr-dica">
        A “confiança” é de onde saiu o <strong>resultado</strong> daquela decisão:{' '}
        {Object.entries(p.config.peso_confianca)
          .map(([k, v]) => `${k === '-' ? 'não identificado' : k} ${v}×`)
          .join(' · ')}. Resultado lido no dispositivo pesa o dobro de resultado
        deduzido da ementa — e um voto ponderado por leitura incerta seria uma conta
        firme sobre dado mole.
      </p>

      <div className="apr-escada">
        <div className={`apr-degrau${fim ? ' acesa' : ''}`} style={{ ['--i' as string]: 0 }}>
          <span className="rot">k-NN sobre os precedentes</span>
          <b>{fim ? um(g.knn) : um(parcial)}</b>
          <p>
            Voto ponderado sobre os {prec.length} análogos acima. Auditável: dá para
            apontar quais decisões produziram o número. <strong>Não há embedding
            nem espaço métrico aqui</strong> — a recuperação é literal (BM25), e o
            “k-NN” é o nome que o sistema dá a esta contagem.
          </p>
        </div>

        <div className={`apr-degrau${n > prec.length ? ' acesa' : ''}`}
          style={{ ['--i' as string]: 1 }}>
          <span className="rot">Floresta aleatória</span>
          <b>{um(g.floresta)}</b>
          <p>
            400 árvores treinadas no histórico, com corte temporal. Ela lê o caso e{' '}
            <strong>não olha os precedentes recuperados</strong> — por isso responde
            quando a busca falha, e por isso a discordância entre as duas significa
            alguma coisa.
          </p>
        </div>

        <div className={`apr-degrau${n > prec.length + 1 ? ' acesa' : ''}`}
          style={{ ['--i' as string]: 2 }}>
          <span className="rot">Conjunto</span>
          <b>{um(g.conjunto)}</b>
          <p>
            Média ponderada das duas: {p.config.peso_knn} × {um(g.knn)} +{' '}
            {(1 - p.config.peso_knn).toFixed(1)} × {um(g.floresta)}.{' '}
            {g.acordo ? 'Os dois concordam no lado.' : 'Os dois discordam do lado.'}
          </p>
        </div>

        <div className={`apr-degrau${n > prec.length + 2 ? ' acesa' : ''}`}
          style={{ ['--i' as string]: 3 }}>
          <span className="rot">Calibração isotônica</span>
          <b>{um(g.calibrado)}</b>
          <p>
            A escala bruta ordena bem mas mente: o sistema dizia 20–30% em casos que
            reformavam 4%. A isotônica corrige a escala sem estragar a ordem. O número
            que sai daqui é o único que a tela mostra ao usuário.
          </p>
        </div>

        <div className={`apr-degrau${n > prec.length + 3 ? ' acesa' : ''}`}
          style={{ ['--i' as string]: 4 }}>
          <span className="rot">Intervalo de 80%</span>
          <b>{g.intervalo ? `${um(g.intervalo[0])} – ${um(g.intervalo[1])}` : '—'}</b>
          <p>
            {p.config.confianca.reamostragens} reamostragens com reposição sobre os
            mesmos {prec.length} precedentes. A incerteza real não está dentro do
            modelo: está no fato de a conta sair de {prec.length} decisões que
            poderiam ter sido outras {prec.length}.
          </p>
        </div>
      </div>

      <div className={`apr-crivo${n >= total ? ' acesa' : ''}`}>
        <span className="rot">O portão — cinco cortes, e o sistema só crava se passar em todos</span>
        <ul>
          {cortes.map((x, i) => {
            const ok = x.v == null ? false
              : x.min ? x.v >= x.corte : x.v <= x.corte
            return (
              <li key={x.rot} className={ok ? 'sim' : 'nao'} style={{ ['--i' as string]: i }}>
                <span>{x.rot}</span>
                <b>{x.v == null ? '—' : x.v.toFixed(x.v >= 3 ? 0 : 3)}</b>
                <small>{x.min ? '≥' : '≤'} {x.corte}</small>
              </li>
            )
          })}
        </ul>
        <p>
          {g.decide
            ? 'Passou nos cinco. Por isso este caso saiu com percentual — e é por '
              + 'isso que, na medição de 400 processos, o sistema fica calado em '
              + '62% das vezes.'
            : 'Não passou. Sai o dossiê de evidências, e nenhum percentual.'}
        </p>
      </div>

      <button className="apr-sair apr-repetir" onClick={() => defN(1)}>
        rodar a conta de novo
      </button>
    </div>
  )
}
