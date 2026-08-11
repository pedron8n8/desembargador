// Qual cérebro (desembargador) a interface está olhando.
//
// Sem Redux e sem Context: é um único slug, e o React Query já é o estado de
// servidor. O que ele guarda é a ESCOLHA, e o resto do app a lê para montar
// URLs e chaves de cache.

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { get, type ListaCerebros } from './api'

const CHAVE = 'cerebro'
// Um evento próprio porque `storage` só dispara em OUTRAS abas: sem isto, o
// seletor mudaria o localStorage e nenhum outro componente desta aba saberia.
const EVENTO = 'cerebro-mudou'

export function useCerebros() {
  return useQuery({
    queryKey: ['cerebros'],
    queryFn: () => get<ListaCerebros>('/api/cerebros'),
    staleTime: 5 * 60_000,
  })
}

/**
 * O slug escolhido, ou '' enquanto a lista não chegou.
 *
 * '' NÃO é um erro: significa "use o padrão do servidor". Quem monta URL usa
 * `qs()` abaixo, que simplesmente omite o parâmetro nesse caso.
 */
export function useCerebro(): [string, (s: string) => void, ListaCerebros | undefined] {
  const { data } = useCerebros()
  const [slug, setSlug] = useState(() => localStorage.getItem(CHAVE) ?? '')

  useEffect(() => {
    const ouvir = () => setSlug(localStorage.getItem(CHAVE) ?? '')
    window.addEventListener(EVENTO, ouvir)
    window.addEventListener('storage', ouvir)
    return () => {
      window.removeEventListener(EVENTO, ouvir)
      window.removeEventListener('storage', ouvir)
    }
  }, [])

  const escolher = useCallback((s: string) => {
    if (s) localStorage.setItem(CHAVE, s)
    else localStorage.removeItem(CHAVE)
    window.dispatchEvent(new Event(EVENTO))
  }, [])

  // Um cérebro desativado (ou renomeado) continuaria salvo aqui e toda rota
  // responderia 404 sem que a tela explicasse por quê. Se o salvo não está mais
  // na lista, volta para o padrão.
  useEffect(() => {
    if (data && slug && !data.itens.some((c) => c.slug === slug)) escolher('')
  }, [data, slug, escolher])

  return [slug, escolher, data]
}

/** O slug efetivo, já resolvido para o padrão do servidor quando não há escolha. */
export function useCerebroEfetivo(): [string, ListaCerebros | undefined] {
  const [slug, , lista] = useCerebro()
  return [slug || lista?.padrao || '', lista]
}

/** `?cerebro=x` — ou string vazia, para o servidor aplicar o padrão dele. */
export const qs = (slug: string, sep = '?') => (slug ? `${sep}cerebro=${encodeURIComponent(slug)}` : '')

/**
 * O slug SEMPRE entra na queryKey de quem depende dele. Sem isso o React Query
 * serve o cache do cérebro anterior ao trocar: dado do acervo errado na tela,
 * sem erro nenhum — o mesmo bug silencioso que o backend evita exigindo o
 * caminho do banco em toda busca.
 */
export const chave = (slug: string, ...resto: unknown[]) => ['cerebro', slug, ...resto]
