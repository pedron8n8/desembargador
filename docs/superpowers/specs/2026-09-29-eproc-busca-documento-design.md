# Extensão eproc — busca por CPF/CNPJ (subprojeto C)

Data: 29/09/2026. Status: **rascunho**. As decisões marcadas **[DECIDIR]** precisam do seu ok. As marcadas
**[HAR]** dependem do subprojeto 0.

Depende de: base (A). Referência: `eproc_guia_tecnico_extensao.md`, seções 5 a 7, 17 e 18 (fluxo validado na
JFRS).

## Objetivo

No painel, o advogado digita um CPF ou CNPJ e vê os processos daquela parte no eproc do TJSC. Serve para
triagem de cliente novo e para achar o processo a analisar.

## Decisões

- **[DECIDIR] Nada sai do navegador.** A lista é montada e exibida no painel e não é enviada à nossa API. Não
  muda a `/privacidade`, que continua dizendo que a busca acontece só no seu navegador.
- **[DECIDIR] Sem inferência de polo na v1.** O guia tem uma heurística para descobrir em qual polo está a parte
  consultada. Ela só serve para gerar resumo textual, que não faz parte desta capacidade. A v1 mostra autor e
  réu como o eproc devolve.
- **[DECIDIR] Só a instância da aba aberta.** Com uma aba do 1º grau, busca no 1º grau. Buscar nas duas
  instâncias exigiria abas logadas nas duas. Fica para depois, se alguém pedir.

## Fluxo

1. Campo "CPF ou CNPJ" no painel, com máscara e **validação antes de consultar**, incluindo o CNPJ
   alfanumérico (guia, seção 17). Um documento inválido devolve "nenhum processo" no eproc, o que parece uma
   resposta boa.
2. O agente roda `buscarPorDocumento(doc)`:
   1. baixa o HTML de `processo_consultar` com `fetch` e lê o link do menu com comparação exata do parâmetro
      `acao`, para não abrir o SIAPRO;
   2. lê a `option[value="CP"]` e a `data-url-verificar-captcha`;
   3. verifica o captcha (`captcha.ts`);
   4. faz o POST da busca com os 13 campos (lista de pares, `fnValidacao[]` duas vezes, documento formatado,
      `chkExibirBaixados=on`).
3. A resposta passa por `sigilo.ts`: os públicos viram lista e os sigilosos viram contagem.
4. O painel mostra, por processo: número formatado, classe, juízo, autor e réu (limpos de HTML e exibidos com
   `textContent`), autuação, último evento e situação. A ordem é a do eproc (autuação, decrescente).
5. Ações por linha:
   - **Abrir no eproc**: abre o `linkProcessoAssinado` (fragmento `#_processo=` reconstruído como query)
     numa aba nova.
   - **Analisar**: abre o processo numa aba nova e dispara o fluxo do subprojeto B nela.

## Regras que não podem falhar

| Situação | Tela |
|---|---|
| `resultados` ausente | `LAYOUT`. Nunca "nenhum processo" |
| `resultados` vazio | "Nenhum processo público encontrado no eproc do TJSC (1º grau). Outros tribunais não são consultados." |
| Só sigilosos | "Há N processos em sigilo que a extensão não mostra." Sem a frase "nenhum processo" |
| Exatamente no teto observado (30 na JFRS) | "A lista pode estar incompleta: o eproc devolveu o máximo de resultados." **[HAR]** Confirmar o teto no TJSC |
| Documento inválido | Bloqueia antes de consultar: "CPF inválido" ou "CNPJ inválido" |

## Código

- `extensao/agente/lib/documento.ts`: validação e máscara de CPF e CNPJ (numérico e alfanumérico). Puro.
- `extensao/agente/lib/busca.ts`: montagem do corpo, parse da resposta e limpeza de `autor`/`reu`
  (`textoSemHtml`, `partesDoCampo` do guia). Puro.
- `extensao/agente/primitivas/buscarPorDocumento.ts`: a orquestração acima, sobre `rede.ts`.
- Painel: a tela de busca.

## Testes

- `node --test`: CPF e CNPJ válidos e inválidos, CNPJ alfanumérico, máscara; corpo com `fnValidacao[]`
  repetido; parse com `<br>`, `&amp;` e "e outros"; lista mista com sigilo; `resultados` ausente → `LAYOUT`;
  lista com 30 itens → aviso; link assinado com fragmento reconstruído.
- Fixtures fictícias a partir do HAR da busca no TJSC.
- Checklist manual: um CPF e um CNPJ reais.

## Pendências do subprojeto 0

- `tipoPesquisa` para CPF (na JFRS só se viu `CP` com CNPJ).
- Se o eproc do TJSC aceita dígitos puros em `strDocParte`.
- Teto de resultados e paginação.
- Se os nomes de campos e ações do TJSC são os mesmos da JFRS.
