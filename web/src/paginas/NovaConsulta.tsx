import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { get, post, type Config } from '../api'

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
      'Puxa também os precedentes que deram provimento, para achar o que eles têm em comum.',
  },
  {
    valor: 'manter',
    titulo: 'Sustentar a manutenção',
    texto: 'O mesmo, do lado que negou provimento.',
  },
]

export function NovaConsulta() {
  const navegar = useNavigate()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: () => get<Config>('/api/config') })
  const [caso, setCaso] = useState('')
  const [tese, setTese] = useState('neutra')
  const [classe, setClasse] = useState('')
  const [anoMin, setAnoMin] = useState('')
  const [soPrognostico, setSoPrognostico] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  const { data: facetas } = useQuery({
    queryKey: ['facetas'],
    queryFn: () => get<Record<string, { valor: string; n: number }[]>>('/api/corpus/facetas'),
    staleTime: Infinity,
  })

  async function arquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setCaso(await f.text())
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setOcupado(true)
    try {
      const r = await post<{ thread: string }>('/api/consultas', {
        caso,
        tese,
        so_prognostico: soPrognostico,
        filtros: { classe: classe || null, ano_min: anoMin ? Number(anoMin) : null },
      })
      navegar(`/consulta/${r.thread}`)
    } catch (x: any) {
      setErro(x.message ?? 'não foi possível iniciar')
      setOcupado(false)
    }
  }

  const nos = soPrognostico ? 3 : 5

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Nova consulta</h1>
          <p className="sub">
            {nos} modelos, dois ciclos de busca. Leva minutos e custa dinheiro de verdade.
          </p>
        </div>
      </header>

      <form onSubmit={enviar} style={{ maxWidth: 760 }}>
        <label className="campo">
          <span>o caso</span>
          <textarea
            value={caso}
            onChange={(e) => setCaso(e.target.value)}
            rows={16}
            required
            placeholder="Cole a peça, o relatório ou a descrição do caso."
            style={{ fontFamily: 'var(--fonte-serif)', fontSize: 'var(--t-md)', lineHeight: 1.55 }}
          />
        </label>
        <p style={{ marginTop: 'calc(var(--e4) * -1)', marginBottom: 'var(--e6)' }}>
          <input type="file" accept=".txt,.md" onChange={arquivo} />
        </p>

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--e6)' }}>
          <legend
            style={{
              fontSize: 'var(--t-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--tinta-3)',
              padding: 0,
              marginBottom: 'var(--e2)',
            }}
          >
            linha de argumentação
          </legend>
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
          <p className="aviso">
            Em “sustentar”, o prognóstico continua sendo calculado na busca <b>neutra</b>: o
            sistema monta a sustentação que você pediu, mas não mente sobre para que lado a
            jurisprudência pende.
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

        <label style={{ display: 'block', marginBottom: 'var(--e6)' }}>
          <input
            type="checkbox"
            checked={soPrognostico}
            onChange={(e) => setSoPrognostico(e.target.checked)}
            style={{ width: 'auto', marginRight: 'var(--e2)' }}
          />
          Só o prognóstico — para antes de redigir a minuta. Custa ~US$ 0,02 em vez de ~US$ 0,20.
        </label>

        {erro && <p className="aviso forte">{erro}</p>}

        <button className="botao" type="submit" disabled={ocupado || !caso.trim()}>
          {ocupado ? 'iniciando…' : soPrognostico ? 'rodar prognóstico' : 'rodar consulta completa'}
        </button>

        {cfg && (
          <p style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-xs)', marginTop: 'var(--e4)' }}>
            modelos em uso:{' '}
            {Object.entries(cfg.modelos)
              .filter(([k]) => !k.startsWith('juiz_') && k !== 'conversa')
              .map(([k, v]) => `${k} → ${v}`)
              .join(' · ')}
            {cfg.julgar_consultas && ' · o juiz automático também é pago em toda consulta'}
          </p>
        )}
      </form>
    </>
  )
}
