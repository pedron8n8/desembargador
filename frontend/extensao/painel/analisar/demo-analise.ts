// Um processo de mentira para apresentar o fluxo "Analisar este processo" sem eproc
// e sem login no sistema (página de demonstração, demo.tsx). Tudo FICTÍCIO: o número
// do processo é o do guia técnico, e o CNPJ e a OAB no texto da inicial estão ali de
// propósito, para a minimização aparecer no caso montado. Nada aqui toca rede.
import type { Capa, Peca } from '../../agente/lib/caso.ts'
import type { Consulta, ListaCerebros } from '../../../src/api.ts'
import type { ResultadoPrecedentes } from '../texto/precedentes.ts'
import { TIPOS } from '../caso/pecas.ts'
import type { ApiAnalise, CorpoConsulta } from './apiAnalise.ts'
import type { DocumentoLido, Fonte } from './fonte.ts'
import type { EventoSse } from './sse.ts'

const NUMERO = '50012345620208240023'
const codificar = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const decodificar = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const CAPA: Capa = {
  numero: NUMERO, classe: 'APELAÇÃO CÍVEL', orgao: '6ª Câmara de Direito Comercial', relator: 'RUBENS SCHULZ',
  assuntos: ['PIS', 'Contribuições Sociais'], poloAtivo: ['EMPRESA EXEMPLO LTDA'], poloPassivo: ['UNIÃO - FAZENDA NACIONAL'],
}

const peca = (evento: number, tipo: string, rotulo: string, data: string, sigiloso = false): Peca =>
  ({ ref: `demo-${evento}`, tipo, rotulo, evento, data, sigiloso })

const PECAS: Peca[] = [
  peca(1, TIPOS.inicial[0], 'PETIÇÃO INICIAL 1', '20/05/2020'),
  peca(8, TIPOS.contestacao[0], 'CONTESTAÇÃO 1', '10/08/2020'),
  peca(12, TIPOS.decisao[0], 'DESPACHO/DECISÃO 1', '01/09/2020'),
  peca(20, 'ATOORD', 'ATO ORDINATÓRIO 1', '15/02/2021'),
  peca(30, 'ATOORD', 'DOCUMENTO RESERVADO 1', '20/06/2021', true),
  peca(45, TIPOS.sentenca[0], 'SENTENÇA 1', '10/03/2022'),
  peca(52, TIPOS.recurso[0], 'APELAÇÃO 1', '02/05/2022'),
]

const TEXTOS: Record<string, DocumentoLido> = {
  'demo-1': { tipo: 'texto', texto: 'EMPRESA EXEMPLO LTDA (CNPJ 11.222.333/0001-81), por seu advogado (OAB/SC 12.345), pede a exclusão do ICMS da base de cálculo do PIS e da Cofins e a restituição do que foi pago a maior.' },
  'demo-8': { tipo: 'texto', texto: 'A União sustenta a legalidade da cobrança e pede a improcedência do pedido.' },
  'demo-12': { tipo: 'texto', texto: 'Cite-se a União para contestar no prazo legal.' },
  'demo-20': { tipo: 'texto', texto: 'Intime-se a autora para réplica.' },
  'demo-45': { tipo: 'texto', texto: 'Julgo improcedente o pedido. Condeno a autora ao pagamento das custas e dos honorários advocatícios.' },
  // o recurso vem como arquivo, para o fluxo passar pela extração do servidor
  'demo-52': { tipo: 'arquivo', nome: 'apelacao.pdf', base64: codificar('A apelante requer a reforma da sentença, com base na tese firmada pelo Supremo Tribunal Federal sobre a exclusão do ICMS.') },
}

export function fonteDemo(pausaMs = 300): Fonte {
  return {
    async capa() { await esperar(pausaMs); return CAPA },
    async pecas() { await esperar(pausaMs); return PECAS },
    async documento(ref) {
      await esperar(pausaMs)
      const d = TEXTOS[ref]
      if (!d) throw new Error('peça desconhecida na demonstração')
      return d
    },
  }
}

const CEREBROS = {
  padrao: 'rubens-schulz',
  minimo_para_cravar: 1500,
  itens: [
    { slug: 'rubens-schulz', nome: 'Rubens Schulz', titulo: 'Desembargador', tribunal: 'TJSC', ativo: true, n_decisoes: 20363, n_merito: 15000, tem_indice: true, tem_floresta: true, calibrado: true, crava: true },
    { slug: 'andre-luiz-dacol', nome: 'André Luiz Dacol', titulo: 'Desembargador', tribunal: 'TJSC', ativo: true, n_decisoes: 9000, n_merito: 6000, tem_indice: true, tem_floresta: true, calibrado: true, crava: true },
  ],
} as ListaCerebros

const NOS = ['triagem', 'recuperar', 'triar', 'prognostico']

// Precedentes FICTÍCIOS (números inventados) para a demonstração da busca por texto.
const PRECEDENTES_DEMO: ResultadoPrecedentes['itens'] = [
  { id: 101, numero: '0001111-22.2019.8.24.0023', classe: 'APELAÇÃO CÍVEL', orgao: '6ª Câmara de Direito Comercial', data: '2023-05-12', resultado: 'provido',
    ementa: 'TRIBUTÁRIO. PIS E COFINS. EXCLUSÃO DO ICMS DA BASE DE CÁLCULO. TESE FIRMADA PELO SUPREMO TRIBUNAL FEDERAL. RECURSO PROVIDO PARA RECONHECER O DIREITO À RESTITUIÇÃO DOS VALORES RECOLHIDOS A MAIOR.' },
  { id: 102, numero: '0002222-33.2020.8.24.0023', classe: 'APELAÇÃO CÍVEL', orgao: '6ª Câmara de Direito Comercial', data: '2022-11-03', resultado: 'desprovido',
    ementa: 'TRIBUTÁRIO. PRESCRIÇÃO QUINQUENAL. PEDIDO DE RESTITUIÇÃO. SENTENÇA MANTIDA. RECURSO DESPROVIDO.' },
  { id: 103, numero: '0003333-44.2021.8.24.0023', classe: 'AGRAVO DE INSTRUMENTO', orgao: '6ª Câmara de Direito Comercial', data: '2024-01-22', resultado: 'parcialmente provido',
    ementa: 'AGRAVO DE INSTRUMENTO. TUTELA DE URGÊNCIA. AUSÊNCIA DOS REQUISITOS LEGAIS NA ORIGEM. DECISÃO REFORMADA EM PARTE PARA AFASTAR A MULTA DIÁRIA.' },
]

export function apiDemo(pausaMs = 400): ApiAnalise & { ultimoCorpo(): CorpoConsulta | null } {
  let corpo: CorpoConsulta | null = null
  return {
    async cerebros() { await esperar(pausaMs); return CEREBROS },
    async limiteDoCaso() { return 20000 },
    async extrair(_nome, base64) { await esperar(pausaMs); return decodificar(base64) },
    async rodar(c) { await esperar(pausaMs); corpo = c; return { thread: 'demo-001' } },
    async acompanhar(_thread, aoEvento) {
      const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 0, tipo, dados })
      aoEvento(ev('inicio', {}))
      for (const no of NOS) {
        aoEvento(ev('no_inicio', { no }))
        await esperar(pausaMs * 2)
        aoEvento(ev('no_fim', { no, custos: [{ custo_usd: 0.004 }] }))
      }
      aoEvento(ev('fim', { segundos: 38.2, custo_usd: 0.016 }))
    },
    async consulta() {
      return {
        prognostico: { decide: true, probabilidade_pct: 61.6, intervalo_pct: [48.2, 74.9], resultado_provavel: 'reforma', n_precedentes: 12, calibrado: true },
        caso_cortado: false,
        max_chars_caso: 20000,
      } as unknown as Consulta
    },
    urlDoSite: (thread) => `#consulta-${thread}`,
    async buscarPrecedentes(q, _cerebro) {
      await esperar(pausaMs)
      if (!q.trim()) return { total: 0, itens: [] }
      return { total: PRECEDENTES_DEMO.length, itens: PRECEDENTES_DEMO }
    },
    urlDoPrecedente: (cerebro, id) => `#acervo-${cerebro}-${id}`,
    ultimoCorpo: () => corpo,
  }
}
