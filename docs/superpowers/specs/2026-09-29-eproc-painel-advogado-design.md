# Extensão eproc — painel do advogado (subprojeto D)

Data: 29/09/2026. Status: **aprovado em 29/09/2026** (decisões [DECIDIR] aceitas; itens [HAR] ainda pendentes). Não há nenhuma captura da tela
`painel_adv_listar`, então o desenho abaixo é o comportamento desejado. Os seletores e as chamadas serão
definidos quando o HAR chegar.

Depende de: base (A). O botão "Analisar" depende de B.

## Objetivo

Mostrar no painel os processos que pedem atenção do advogado (intimações e prazos abertos), para que ele
escolha o que analisar sem navegar pelo eproc.

## Decisões

- **[DECIDIR] Nada sai do navegador.** Lista montada e exibida só no painel, como na busca (C).
- **[DECIDIR] Escopo v1: intimações e prazos pendentes.** É o que o painel do advogado do eproc costuma
  mostrar e o que tem valor de triagem. Relatórios, lembretes e processos favoritos ficam de fora.
- **[DECIDIR] Sem cálculo de prazo próprio.** Mostramos o prazo como o eproc informa. Calcular prazo processual
  (feriados, suspensões) é responsabilidade jurídica que não queremos assumir. O eproc já faz isso
  (`processo/listar_suspensoes_e_feriados`).
- **[DECIDIR] Sem notificação em segundo plano.** A lista é lida quando o painel abre ou quando o advogado clica
  em **Atualizar**. Alertas com o painel fechado exigiriam service worker persistente, que a arquitetura da base
  descartou.

## Fluxo

1. Aba **Painel** no painel lateral → o agente roda `painelAdvogado()`.
2. `painelAdvogado()` baixa o HTML de `painel_adv_listar` (a URL assinada vem do menu da página atual) e as
   chamadas AJAX que a tela fizer. **[HAR]**
3. Cada item: número do processo, classe, tipo do item (intimação, prazo), data de início, data final do
   prazo como o eproc mostra e evento. Itens de processos em sigilo aparecem só com a contagem.
4. Ordem: prazo final crescente. Os que vencem em até 5 dias úteis, **segundo a data que o eproc informa**,
   ficam destacados.
5. Ações por item: **Abrir no eproc** e **Analisar** (fluxo de B numa aba nova).

## Regras

- Estrutura não reconhecida → `LAYOUT`. Nunca "nenhuma intimação".
- Lista vazia de verdade → "Nenhuma intimação ou prazo pendente no eproc do TJSC (1º grau)", sempre dizendo a
  instância.
- O painel só lê. Abrir uma intimação pode registrar ciência no eproc, o que tem efeito processual. **A extensão
  nunca abre, marca ou consulta o conteúdo de uma intimação.** Ela lê só a listagem. **[HAR]** É preciso
  confirmar, no HAR, qual chamada registra ciência, para bloqueá-la no agente com uma lista de ações proibidas
  em `rede.ts`.

## Testes

- `node --test`: parse da listagem (fixture fictícia a partir do HAR), ordenação, destaque, sigilo, `LAYOUT`.
- Teste que garante que nenhuma primitiva chama uma ação da lista de proibidas.

## Pendências do subprojeto 0

- O HAR completo da tela `painel_adv_listar` e das chamadas AJAX dela.
- Qual ação registra ciência de intimação (para bloquear).
- Se o painel pagina.
