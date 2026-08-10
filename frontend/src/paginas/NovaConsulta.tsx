import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ACEITA, extrairArquivo, get, post, type Config } from '../api'
import { qs, useCerebro, useCerebroEfetivo } from '../cerebro'

// as mesmas seções de exemplos/caso.txt — `titulo` vai verbatim pro texto final,
// porque é assim que o prompt da triagem já vê o caso hoje
const SECOES = [
  {
    chave: 'partes',
    rotulo: 'identificação e partes',
    titulo: 'PARTES E PROCESSO',
    dica: 'Que ação é, quem move contra quem, comarca e vara.',
  },
  {
    chave: 'fatos',
    rotulo: 'fatos',
    titulo: 'FATOS',
    dica: 'O que aconteceu, em ordem. Datas, valores, laudos, o que a outra parte respondeu.',
  },
  {
    chave: 'sentenca',
    rotulo: 'sentença',
    titulo: 'SENTENÇA',
    dica: 'O que o juízo decidiu e com que fundamento. Sucumbência, se importar.',
  },
  {
    chave: 'recurso',
    rotulo: 'recurso do autor',
    titulo: 'RECURSO DO AUTOR',
    dica: 'As razões, uma por linha. É a parte que mais pesa na busca por precedente.',
  },
  {
    chave: 'contra',
    rotulo: 'contrarrazões',
    titulo: 'CONTRARRAZÕES',
    dica: 'O que a parte contrária sustenta contra o recurso.',
  },
]

const LEGENDA: React.CSSProperties = {
  fontSize: 'var(--t-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--tinta-3)',
  padding: 0,
  marginBottom: 'var(--e2)',
}

function montar(secoes: Record<string, string>, abertas: Record<string, boolean>) {
  return SECOES.filter((s) => abertas[s.chave] && secoes[s.chave]?.trim())
    .map((s) => `${s.titulo}\n${secoes[s.chave].trim()}`)
    .join('\n\n')
}

const TESES: { valor: string; titulo: string; texto: string }[] = [
  {
    valor: 'neutra',
    titulo: 'Neutra',
    texto:
      'O que o acervo diz, sem lado. É a única em que o percentual vale como probabilidade.',
  },
  {
    valor: 'reformar',
    titulo: 'Sustentar a reforma',
    texto:
      'A triagem lê cada candidato e mantém só os que sustentam dar provimento — e mostra quantos descartou por decidirem contra.',
  },
  {
    valor: 'manter',
    titulo: 'Sustentar a manutenção',
    texto: 'O mesmo, do lado de negar provimento e manter a sentença.',
  },
]

export function NovaConsulta() {
  const navegar = useNavigate()
  const [cerebro, , lista] = useCerebro()
  const [efetivo] = useCerebroEfetivo()
  // o slug entra na queryKey: sem isso o React Query serve as facetas e a
  // config do cérebro anterior depois de trocar — dado do acervo errado, sem
  // erro nenhum
  const { data: cfg } = useQuery({
    queryKey: ['config', efetivo],
    queryFn: () => get<Config>(`/api/config${qs(cerebro)}`),
  })
  const [modo, setModo] = useState<'secoes' | 'livre'>('secoes')
  const [livre, setLivre] = useState('')
  const [secoes, setSecoes] = useState<Record<string, string>>({})
  // desmarcada só sai do envio: o texto fica guardado e volta ao remarcar
  const [abertas, setAbertas] = useState<Record<string, boolean>>({
    partes: true,
    fatos: true,
    sentenca: true,
    recurso: true,
  })
  const caso = modo === 'livre' ? livre : montar(secoes, abertas)
  const [tese, setTese] = useState('neutra')
  const [classe, setClasse] = useState('')
  const [anoMin, setAnoMin] = useState('')
  const [soPrognostico, setSoPrognostico] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState('')
  // segundo ponto de vista: a mesma peça lida por outro desembargador
  const [outros, setOutros] = useState<string[]>([])

  const { data: facetas } = useQuery({
    queryKey: ['facetas', efetivo],
    queryFn: () =>
      get<Record<string, { valor: string; n: number }[]>>(`/api/corpus/facetas${qs(cerebro)}`),
    staleTime: Infinity,
  })

  const disponiveis = (lista?.itens ?? []).filter((c) => c.slug !== efetivo)
  const comparando = outros.length > 0
  const nCerebros = 1 + outros.length

  async function arquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setErro('')
    setLendo(true)
    try {
      // extração no servidor, sempre: é lá que estão o pypdf e o OCR, e é lá
      // que o formato é conferido antes de virar prompt pago
      setLivre((await extrairArquivo(f)).texto)
    } catch (x: any) {
      setErro(x.message ?? 'não foi possível ler o arquivo')
    } finally {
      setLendo(false)
      e.target.value = '' // deixa subir o mesmo arquivo de novo depois de editado
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setOcupado(true)
    try {
      const corpo = {
        caso,
        tese,
        so_prognostico: soPrognostico,
        filtros: { classe: classe || null, ano_min: anoMin ? Number(anoMin) : null },
      }
      if (comparando) {
        const r = await post<{ comparacao: string }>('/api/comparacoes', {
          ...corpo,
          cerebros: [efetivo, ...outros],
        })
        navegar(`/comparacao/${r.comparacao}`)
      } else {
        const r = await post<{ thread: string }>('/api/consultas', {
          ...corpo,
          cerebro: efetivo,
        })
        navegar(`/consulta/${r.thread}`)
      }
    } catch (x: any) {
      setErro(x.message ?? 'não foi possível iniciar')
      setOcupado(false)
    }
  }

  // cada cérebro roda o pipeline inteiro: o custo multiplica, e a tela diz isso
  const nos = (soPrognostico ? 3 : 5) * nCerebros
  const usd = (soPrognostico ? 0.01 : 0.04) * nCerebros

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Nova consulta</h1>
          <p className="sub">
            {comparando ? `${nCerebros} cérebros · ` : ''}
            {nos} chamadas de modelo, dois ciclos de busca. Leva minutos e custa dinheiro de
            verdade (~US$ {usd.toFixed(2)}).
          </p>
        </div>
      </header>

      <form onSubmit={enviar} style={{ maxWidth: 760 }}>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--e4)' }}>
          <legend style={LEGENDA}>o caso</legend>
          {(['secoes', 'livre'] as const).map((m) => (
            <label key={m} style={{ marginRight: 'var(--e4)', cursor: 'pointer' }}>
              <input
                type="radio"
                name="modo"
                checked={modo === m}
                onChange={() => setModo(m)}
                style={{ width: 'auto', marginRight: 'var(--e2)' }}
              />
              {m === 'secoes' ? 'por seções' : 'colar tudo'}
            </label>
          ))}
        </fieldset>

        {modo === 'secoes' ? (
          <div style={{ marginBottom: 'var(--e6)' }}>
            {SECOES.map((s) => {
              const texto = secoes[s.chave] ?? ''
              return (
                <div key={s.chave} style={{ marginBottom: 'var(--e2)' }}>
                  <label style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!abertas[s.chave]}
                      onChange={(e) => setAbertas((v) => ({ ...v, [s.chave]: e.target.checked }))}
                      style={{ width: 'auto', marginRight: 'var(--e2)' }}
                    />
                    {s.rotulo}
                    {!abertas[s.chave] && texto.trim() && (
                      <span className="prec-meta">
                        {' '}
                        — {texto.trim().length} caracteres escritos, fora do envio
                      </span>
                    )}
                  </label>
                  {abertas[s.chave] && (
                    <textarea
                      value={texto}
                      onChange={(e) => setSecoes((v) => ({ ...v, [s.chave]: e.target.value }))}
                      rows={6}
                      placeholder={s.dica}
                      style={{
                        fontFamily: 'var(--fonte-serif)',
                        fontSize: 'var(--t-md)',
                        lineHeight: 1.55,
                        marginTop: 'var(--e1)',
                      }}
                    />
                  )}
                </div>
              )
            })}
            <p className="aviso">
              Nenhuma seção é obrigatória — desmarque o que o seu caso não tem. As marcadas
              viram um texto só, com o título em caixa alta, do jeito que o modelo lê melhor.
            </p>
          </div>
        ) : (
          <>
            <label className="campo">
              <span>peça completa</span>
              <textarea
                value={livre}
                onChange={(e) => setLivre(e.target.value)}
                rows={16}
                placeholder="Cole a peça, o relatório ou a descrição do caso."
                style={{
                  fontFamily: 'var(--fonte-serif)',
                  fontSize: 'var(--t-md)',
                  lineHeight: 1.55,
                }}
              />
            </label>
            <p style={{ marginTop: 'calc(var(--e4) * -1)', marginBottom: 'var(--e6)' }}>
              <input type="file" accept={ACEITA} onChange={arquivo} disabled={lendo} />
              <span className="prec-meta">
                {lendo ? ' extraindo o texto…' : ' .pdf, .docx, .txt ou .md — substitui a caixa'}
              </span>
            </p>
          </>
        )}

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--e6)' }}>
          <legend style={LEGENDA}>linha de argumentação</legend>
          {TESES.map((t) => (
            <label
              key={t.valor}
              style={{
                display: 'block',
                borderLeft: `2px solid ${tese === t.valor ? 'var(--selo)' : 'var(--linha)'}`,
                padding: 'var(--e2) var(--e4)',
                marginBottom: 'var(--e2)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="tese"
                value={t.valor}
                checked={tese === t.valor}
                onChange={() => setTese(t.valor)}
                style={{ width: 'auto', marginRight: 'var(--e2)' }}
              />
              <strong style={{ fontWeight: 500 }}>{t.titulo}</strong>
              <div style={{ color: 'var(--tinta-2)', fontSize: 'var(--t-sm)', paddingLeft: 22 }}>
                {t.texto}
              </div>
            </label>
          ))}
          <p className="aviso forte">
            Em “sustentar” <b>não sai prognóstico</b>. A amostra passa a ser escolhida por
            sustentar o seu lado, e contar resultado nela mediria a escolha, não o tribunal. O que
            o sistema entrega no lugar é mais útil: quantos precedentes análogos decidem{' '}
            <b>contra</b> você. Para o percentual calibrado, rode a mesma peça em neutra.
          </p>
        </fieldset>

        <div style={{ display: 'flex', gap: 'var(--e4)', flexWrap: 'wrap' }}>
          <label className="campo" style={{ flex: '1 1 260px' }}>
            <span>classe processual (opcional)</span>
            <select value={classe} onChange={(e) => setClasse(e.target.value)}>
              <option value="">todas — recomendado</option>
              {(facetas?.classe ?? []).map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.valor} ({f.n.toLocaleString('pt-BR')})
                </option>
              ))}
            </select>
          </label>
          <label className="campo" style={{ flex: '0 1 160px' }}>
            <span>a partir do ano</span>
            <input
              type="number"
              value={anoMin}
              min={2000}
              max={2026}
              onChange={(e) => setAnoMin(e.target.value)}
              placeholder="—"
            />
          </label>
        </div>
        <p className="aviso" style={{ marginTop: 'calc(var(--e4) * -1)', marginBottom: 'var(--e6)' }}>
          Filtrar por classe <b>não ajuda</b>: medido em 400 casos cegos, a precisão fica igual
          ou levemente melhor sem o filtro — ele descarta casos análogos que vieram por outra
          via recursal. Use só se souber por quê.
        </p>

        {disponiveis.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--e6)' }}>
            <legend style={LEGENDA}>segundo ponto de vista (opcional)</legend>
            {disponiveis.map((c) => (
              <label key={c.slug} style={{ display: 'block', marginBottom: 'var(--e2)' }}>
                <input
                  type="checkbox"
                  checked={outros.includes(c.slug)}
                  onChange={(e) =>
                    setOutros((v) =>
                      e.target.checked ? [...v, c.slug] : v.filter((x) => x !== c.slug),
                    )
                  }
                  style={{ width: 'auto', marginRight: 'var(--e2)' }}
                />
                rodar também com <b>{c.titulo} {c.nome}</b>
                {!c.crava && (
                  <span className="prec-meta"> — acervo pequeno: entrega precedentes, não percentual</span>
                )}
              </label>
            ))}
            {comparando && (
              <p className="aviso forte">
                A mesma peça vai rodar {nCerebros} vezes, uma por acervo, e{' '}
                <b>o custo multiplica por {nCerebros}</b>. O que muda entre eles são os
                precedentes e o número — não a peça. Para comparar barato, marque “só o
                prognóstico” abaixo.
              </p>
            )}
          </fieldset>
        )}

        <label style={{ display: 'block', marginBottom: 'var(--e6)' }}>
          <input
            type="checkbox"
            checked={soPrognostico}
            onChange={(e) => setSoPrognostico(e.target.checked)}
            style={{ width: 'auto', marginRight: 'var(--e2)' }}
          />
          Só o prognóstico — para antes de redigir a minuta. Custa ~US${' '}
          {(0.01 * nCerebros).toFixed(2)} em vez de ~US$ {(0.04 * nCerebros).toFixed(2)}.
        </label>

        {erro && <p className="aviso forte">{erro}</p>}

        <button className="botao" type="submit" disabled={ocupado || lendo || !caso.trim()}>
          {ocupado
            ? 'iniciando…'
            : comparando
              ? `comparar ${nCerebros} cérebros`
              : soPrognostico
                ? 'rodar prognóstico'
                : 'rodar consulta completa'}
        </button>

        {cfg && (
          <p style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-xs)', marginTop: 'var(--e4)' }}>
            modelos em uso:{' '}
            {Object.entries(cfg.modelos)
              .filter(([k]) => !k.startsWith('juiz_') && k !== 'conversa')
              .map(([k, v]) => `${k} → ${v}`)
              .join(' · ')}
            {cfg.julgar_consultas && ' · o juiz automático também é pago em toda consulta'}
            <br />
            acervo: {cfg.cerebro_nome} — {cfg.n_merito.toLocaleString('pt-BR')} decisões de mérito
            {!cfg.calibrado && ' · sem calibrador: o percentual ordena, não é probabilidade'}
            {cfg.n_merito < cfg.minimo_para_cravar &&
              ' · abaixo do mínimo para prognóstico — este cérebro entrega precedentes, não percentual'}
          </p>
        )}
      </form>
    </>
  )
}
