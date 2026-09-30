// Cliente da API. No site as rotas são same-origin (o Vite faz proxy de /api) e o
// cookie de sessão vai sozinho. No painel da extensão, `VITE_API_BASE` prefixa a
// rota e `credentials: 'include'` manda o cookie entre origens (permitido porque
// a extensão tem host_permissions para a origem da API).

export class ErroApi extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem)
  }
}

export async function req<T>(rota: string, init?: RequestInit): Promise<T> {
  const mutante = init?.method && init.method !== 'GET'
  // No site, VITE_API_BASE é undefined e a rota continua relativa (same-origin).
  // No painel da extensão, a página é chrome-extension://, então a rota precisa
  // da origem da API, e o cookie só vai com credentials: 'include'.
  const r = await fetch((import.meta.env.VITE_API_BASE ?? '') + rota, {
    credentials: 'include',
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
export const put = <T,>(rota: string, corpo?: unknown) =>
  req<T>(rota, { method: 'PUT', body: JSON.stringify(corpo ?? {}) })
export const del = <T,>(rota: string) => req<T>(rota, { method: 'DELETE' })

/** Extensões que o servidor sabe ler. Só filtro do diálogo — quem decide o
 *  formato de verdade é o magic byte, no servidor (src/rag/extrair.py). */
export const ACEITA = '.txt,.md,.pdf,.docx'

/**
 * Arquivo -> texto, pelo servidor: PDF sai pelo pypdf, DOCX pelo zipfile, e
 * PDF escaneado passa por OCR — coisas que o navegador não faz. Vai em base64
 * no JSON de sempre, então `req()` acima continua servindo, com CSRF e tudo.
 */
export async function extrairArquivo(f: File) {
  const dados = await new Promise<string>((ok, falha) => {
    const leitor = new FileReader()
    // readAsDataURL em vez de btoa(String.fromCharCode(...)): o segundo estoura
    // a pilha em arquivo grande, que é justamente o caso de um PDF de peça
    leitor.onload = () => ok(String(leitor.result).split(',')[1] ?? '')
    leitor.onerror = () => falha(new Error('não foi possível ler o arquivo'))
    leitor.readAsDataURL(f)
  })
  return post<{ texto: string; chars: number; custo_usd: number }>('/api/extrair', {
    nome: f.name,
    dados,
  })
}

// --------------------------------------------------------------- tipos

/**
 * 'superadmin' manda nos CÉREBROS (quem fica disponível para julgar); 'admin'
 * manda nas contas do escritório. Quem manda em consulta alheia são os dois —
 * use `manda()`, nunca `papel === 'admin'`.
 */
export type Papel = 'advogado' | 'admin' | 'superadmin'

export const manda = (u?: { papel: Papel }) =>
  u?.papel === 'admin' || u?.papel === 'superadmin'

export const ROTULO_PAPEL: Record<Papel, string> = {
  advogado: 'advogado',
  admin: 'administrador',
  superadmin: 'superadministrador',
}

export type Usuario = {
  email: string
  papel: Papel
  sessoes: { criado_em: string; expira_em: string; ip: string; agente: string }[]
}

/** Um "segundo cérebro": o acervo de um desembargador, com seus artefatos. */
export type Cerebro = {
  slug: string
  nome: string
  titulo: string
  tribunal: string
  ativo: boolean
  n_decisoes: number
  n_merito: number
  tem_indice: boolean
  tem_floresta: boolean
  calibrado: boolean
  /** false = acervo pequeno demais; o sistema recusa o percentual de propósito */
  crava: boolean
}

export type ListaCerebros = {
  padrao: string
  minimo_para_cravar: number
  itens: Cerebro[]
}

export type ItemComparacao = {
  thread: string
  cerebro: string
  cerebro_nome: string
  cerebro_titulo: string
  estado: string
  erro: string | null
  segundos: number | null
  so_prognostico: boolean
  custo_usd: number | null
  tem_minuta: boolean
  prognostico: Prognostico
  n_precedentes: number | null
  decide: boolean | null
  calibrado: boolean | null
  probabilidade_pct: number | null
  resultado_provavel: string | null
}

export type Comparacao = {
  comparacao: string
  caso: string
  criado_em: string
  itens: ItemComparacao[]
  /**
   * Diferença em pontos percentuais — só quando os dois lados são comparáveis.
   * Quem decide é o servidor: comparar um número calibrado com um cru, ou com
   * um lado que se recusou a cravar, fabricaria precisão que ninguém mediu.
   */
  delta_pp: number | null
  por_que_sem_delta: string | null
}

/** uma linha da lista de comparações — sem abrir checkpoint, ver /api/comparacoes */
export type ItemListaComparacao = {
  comparacao: string
  criado_em: string
  cerebros: string[]
  estados: string[]
  resumo: string
  custo_usd: number
  delta_pp: number | null
  por_que_sem_delta: string | null
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
  /** veredito da triagem no modo tese; vazio no modo neutro, onde não se pergunta */
  lado?: 'a_favor' | 'contra' | 'neutro' | ''
  ementa: string
  ementa_truncada: boolean
  ancoras: string[]
  efeito: { transitou?: boolean; subiu?: boolean; sobrestado?: boolean } | null
  ficha: string
  porque_rank: Record<string, number>
  explicacao_rank: string
}

/** O que se repete entre os precedentes que sustentam a tese (sinais.comuns). */
export type Comuns = {
  n?: number
  ancoras?: [string, number][]
  orgaos?: [string, number][]
  classes?: [string, number][]
  unanimes?: number
  transitaram?: number
  anos?: number[]
}

export type Prognostico = {
  decide?: boolean
  /**
   * true quando a consulta pediu um lado: a amostra foi escolhida por sustentar
   * a tese, então NÃO sai percentual — contar resultado aqui mede a escolha.
   */
  enviesado?: boolean
  tese?: string
  faixa?: string
  /** quem julgou; sai do próprio prognóstico para o .md e a lista não divergirem */
  cerebro?: string
  cerebro_nome?: string
  /** decisões de mérito no acervo — abaixo do mínimo, o sistema não crava */
  n_merito_acervo?: number
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
  /** quem julgou. NÃO confundir com `perfil`, que é o perfil do ARGUMENTO. */
  cerebro: string
  cerebro_nome: string
  cerebro_titulo: string
  cerebro_tribunal: string
  filtros: Record<string, unknown>
  triagem: { classe?: string; materia?: string; tese?: string; pedidos?: string[]; termos?: string[] }
  consulta_fts: string
  precedentes: Precedente[]
  /** @deprecated sempre vazio: no modo tese os `precedentes` JÁ são a sustentação */
  sustentacao: Precedente[]
  /** quantos candidatos análogos a triagem descartou, e por quê */
  descartados: { contra?: number; neutro?: number }
  comuns: Comuns
  perfil: Record<string, any>
  contra: Record<string, any>
  n_candidatos: number
  /** true se o caso passou de `max_chars_caso` e foi cortado antes de chegar aos nós de LLM */
  caso_cortado: boolean
  max_chars_caso: number
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
  cerebro: string
  cerebro_nome: string
  /** id do grupo quando esta consulta faz parte de uma comparação */
  comparacao: string | null
  custo_usd: number | null
  nota_humano: number | null
  nota_juiz: number | null
  decide: boolean | null
  probabilidade_pct: number | null
  resultado_provavel: string | null
  estado: string
  erro: string | null
  da_cli: boolean
  /** processo do eproc (20 dígitos) quando a consulta veio da extensão */
  origem_eproc: string | null
  origem_instancia: '1g' | '2g' | null
}

export type Acompanhado = { processo: string; instancia: '1g' | '2g' | null; criado_em: string }

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
  lado?: 'a_favor' | 'contra' | 'neutro' | ''
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
  /** os modelos são do sistema; floresta/calibrado são deste CÉREBRO */
  cerebro: string
  cerebro_nome: string
  modelos: Record<string, string>
  temperatura: Record<string, number>
  max_tokens: Record<string, number>
  busca: Record<string, number | boolean>
  rerank: Record<string, any>
  floresta: { peso_knn: number | null; disponivel: boolean; treinado_ate: number | null; n_treino: number | null }
  confianca: Record<string, number>
  calibrado: boolean
  n_merito: number
  minimo_para_cravar: number
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
