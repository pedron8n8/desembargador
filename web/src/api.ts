// Cliente da API. Same-origin (o Vite faz proxy de /api), então o cookie de
// sessão vai sozinho e não há CORS nem `credentials` para configurar.

export class ErroApi extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem)
  }
}

async function req<T>(rota: string, init?: RequestInit): Promise<T> {
  const mutante = init?.method && init.method !== 'GET'
  const r = await fetch(rota, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      // Sem este cabeçalho o servidor recusa qualquer método mutante. É o que
      // fecha CSRF junto com SameSite=Lax: um <form> de outro site não
      // consegue mandá-lo.
      ...(mutante ? { 'X-Requerido-Por': 'web' } : {}),
      ...init?.headers,
    },
  })
  if (!r.ok) {
    let msg = r.statusText
    try {
      msg = (await r.json()).detail ?? msg
    } catch {
      /* resposta sem JSON: fica o statusText */
    }
    throw new ErroApi(r.status, msg)
  }
  if (r.status === 204) return undefined as T
  const tipo = r.headers.get('content-type') ?? ''
  return (tipo.includes('application/json') ? r.json() : r.text()) as Promise<T>
}

export const get = <T,>(rota: string) => req<T>(rota)
export const post = <T,>(rota: string, corpo?: unknown) =>
  req<T>(rota, { method: 'POST', body: JSON.stringify(corpo ?? {}) })
export const del = <T,>(rota: string) => req<T>(rota, { method: 'DELETE' })

// --------------------------------------------------------------- tipos

export type Usuario = {
  email: string
  papel: 'advogado' | 'admin'
  sessoes: { criado_em: string; expira_em: string; ip: string; agente: string }[]
}

export type Precedente = {
  id: number
  numero: string
  classe: string | null
  orgao: string | null
  comarca: string | null
  data: string | null
  ano: number | null
  url: string | null
  resultado: string | null
  confianca: string | null
  ancora: string | null
  unanime: number | null
  score: number | null
  pontos: number | null
  nota: number | null
  por_que: string | null
  neutro?: boolean
  ementa: string
  ementa_truncada: boolean
  ancoras: string[]
  efeito: { transitou?: boolean; subiu?: boolean; sobrestado?: boolean } | null
  ficha: string
  porque_rank: Record<string, number>
  explicacao_rank: string
}

export type Prognostico = {
  decide?: boolean
  faixa?: string
  probabilidade_pct?: number | null
  intervalo_pct?: [number, number] | null
  calibrado?: boolean
  resultado_provavel?: string
  confianca_pct?: number
  distribuicao?: [string, number][]
  n_precedentes?: number
  reforma_nos_precedentes?: number | null
  reforma_conjunta_pct?: number | null
  reforma_historica_classe?: number | null
  classe_base?: string
  n_classe?: number
  floresta?: { p_reforma: number; n_treino: number; treinado_ate: number } | null
  fonte?: string
  acordo?: boolean | null
  divergencia?: string
  confianca?: { por_que?: string[]; margem?: number; concordancia?: number }
  revisao_aprovou?: boolean
  revisao_problemas?: string[]
}

export type Custo = {
  no: string
  modelo: string
  tokens_in: number
  tokens_out: number
  custo_usd: number
  cortado?: boolean
}

export type Consulta = {
  thread: string
  estado: string
  erro: string | null
  proximo_no: string | null
  segundos: number | null
  caso: string
  tese: string
  filtros: Record<string, unknown>
  triagem: { classe?: string; materia?: string; tese?: string; pedidos?: string[]; termos?: string[] }
  consulta_fts: string
  precedentes: Precedente[]
  sustentacao: Precedente[]
  comuns: Record<string, unknown>
  perfil: Record<string, any>
  contra: Record<string, any>
  n_candidatos: number
  prognostico: Prognostico
  minuta: string
  criticas: string[]
  julgamento: { notas?: Record<string, number>; media?: number; juiz?: string; resumo?: string; modo?: string }
  custos: Custo[]
  custo_total: number
  markdown: string | null
}

export type ItemLista = {
  thread: string
  criado_em: string
  resumo: string
  custo_usd: number | null
  nota_humano: number | null
  nota_juiz: number | null
  decide: boolean | null
  probabilidade_pct: number | null
  resultado_provavel: string | null
  estado: string
  erro: string | null
  da_cli: boolean
}

export type LinhaPeso = {
  id: number
  numero: string
  resultado: string
  ano: number | null
  bm25: number | null
  base: number
  fatores: Record<string, number>
  produto_fatores: number
  pontos: number | null
  peso_confianca: number
  rotulo_confianca: string
  nota: number | null
  nota_norm: number
  peso_final: number
  fracao_do_total: number
}

export type Pesos = {
  config: {
    rerank: Record<string, any>
    peso_confianca: Record<string, number>
    peso_knn: number | null
    confianca: Record<string, number>
    calibrado: boolean
  }
  precedentes: LinhaPeso[]
  agregacao: {
    knn: number | null
    floresta: number | null
    conjunto: number | null
    calibrado: number | null
    intervalo: [number, number] | null
    fonte: string | null
    acordo: boolean | null
    decide: boolean | null
    confianca: { por_que?: string[] }
  }
}

export type NoRede = {
  id: number | string
  tipo: 'decisao' | 'ancora'
  numero?: string
  classe?: string
  ano?: number
  resultado?: string
  nota?: number
  pontos?: number
  ancora?: string
  unanime?: number
  precedente?: boolean
  sustentacao?: boolean
  ancoras?: string[]
  rotulo?: string
  chave?: string
  grau?: number
  vinculante?: boolean
}

export type Rede = {
  nos: NoRede[]
  arestas: { de: number | string; para: number | string; tipo: 'ancora' | 'texto'; peso: number; rotulo: string | null }[]
  resumo: {
    n_decisoes: number
    n_ancoras: number
    n_arestas: number
    por_ancora: number
    por_texto: number
    isolados: number
    ancoras_distintas: number
  }
}

export type Config = {
  modelos: Record<string, string>
  temperatura: Record<string, number>
  max_tokens: Record<string, number>
  busca: Record<string, number | boolean>
  rerank: Record<string, any>
  floresta: { peso_knn: number | null; disponivel: boolean; treinado_ate: number | null; n_treino: number | null }
  confianca: Record<string, number>
  calibrado: boolean
  julgar_consultas: boolean
  peso_confianca: Record<string, number>
  teses: Record<string, string[]>
}

export type Mensagem = {
  id: number
  papel: 'usuario' | 'assistente'
  texto: string
  modelo: string | null
  custo_usd: number | null
  criado_em: string
}
