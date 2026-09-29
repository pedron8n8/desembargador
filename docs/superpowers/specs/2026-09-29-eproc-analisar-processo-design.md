# Extensão eproc — "Analisar este processo" (subprojeto B)

Data: 29/09/2026. Status: **aprovado em 29/09/2026** (decisões [DECIDIR] aceitas; itens [HAR] ainda pendentes). As marcadas **[HAR]** dependem do
subprojeto 0.

Depende de: base (A), `2026-09-29-eproc-extensao-base-design.md`.

## Objetivo

O advogado está num processo no eproc, abre o painel e clica em **Analisar**. A extensão monta sozinha o texto
do caso a partir do eproc (capa, partes, assuntos e as peças-chave) e roda a consulta que hoje exige copiar e
colar ou subir arquivo. Hoje esse caminho é: o advogado escreve ou cola o caso, ou sobe uma peça em
`/api/extrair`, e roda `POST /api/consultas`.

Sucesso: do clique ao prognóstico sem sair do eproc, com o advogado vendo e podendo editar o texto antes de
gastar a consulta.

## Fluxo

1. O painel já sabe, por `estado()`, que a aba está num processo (número de 20 dígitos).
2. Clique em **Analisar** → o agente roda `processo(num)` e `eventos(num)`.
3. O painel mostra a lista de peças com as mais relevantes pré-marcadas e um contador de caracteres.
4. O advogado ajusta as marcas e clica em **Montar** → o agente baixa as peças marcadas com `documento(ref)`.
   - HTML: vira texto na própria aba (`DOMParser` e `textContent`).
   - PDF: os bytes vão para `POST /api/extrair` (o endpoint que já existe), que devolve o texto.
5. O painel mostra o texto montado, editável, e os campos que a consulta já aceita: cérebro, tese
   (`neutra | reformar | manter`) e filtros.
6. **Rodar** → `POST /api/consultas` com o texto. O progresso chega por
   `GET /api/consultas/{thread}/eventos` (SSE, já existe) e aparece no painel.
7. Fim: o painel mostra o prognóstico resumido e o botão **Abrir no sistema**, que abre a consulta completa
   no site.

## Primitivas novas no agente

Todas passam por `rede.ts` (fila, decodificação, detecção de sessão caída) e por `sigilo.ts`.

### `processo(num)` → capa

- Se a aba já está no detalhe desse processo, lê o DOM atual. Senão, baixa o HTML de `processo_selecionar`
  e faz o parse. A URL assinada vem de um link da página atual ou de uma busca por número
  (`processos_consulta_por_numprocesso`). **[HAR]**
- Campos: número, classe, órgão julgador, magistrado ou relator, autuação, situação, competência, assuntos
  (código TPU, descrição, principal) e polos com os nomes das partes.
- **[DECIDIR] Minimização:** CPF, CNPJ e OAB são **removidos** antes de sair da aba. Os nomes das partes ficam,
  porque a minuta se refere a eles. Os advogados não entram.
- Processo em sigilo → `SIGILOSO`, e nada mais é lido.

### `eventos(num)` → lista de eventos com documentos

- Todas as páginas: o HTML inicial traz 100 eventos, e o resto vem de `processo_selecionar_pagina`. **[HAR]**
- Cada documento: tipo (`data-nome`, por exemplo `INIC`, `SENT`, `DESPADEC`), rótulo, evento, data, mimetype,
  tamanho e nível de sigilo (do `title`).
- O painel recebe uma **referência opaca** (índice) de cada documento. A URL com `doc`, `evento`, `key` e
  `hash` fica guardada só no agente.
- Documento com nível de sigilo maior que 0 aparece na lista desabilitado, com o motivo, e nunca é baixado.

### `documento(ref)` → `{tipo: "texto", texto}` ou `{tipo: "arquivo", bytes, nome}`

- `GET acessar_documento`. Falta confirmar se a resposta é o documento direto, uma tela intermediária ou um
  pedido de 2FA. **[HAR]**
- Se aparecer 2FA ou uma tela intermediária: erro novo `DOC_2FA`, com a mensagem "O eproc pediu confirmação
  para abrir documentos. Abra um documento manualmente na aba do eproc e tente de novo." A extensão nunca
  preenche o 2FA.
- Teto: 20 MB, o mesmo `LIMITE_BYTES` do `/api/extrair`.

## Seleção e montagem do caso

**[DECIDIR] Pré-seleção por tipo.** Os códigos são da JFRS e precisam ser conferidos no TJSC **[HAR]**:

| Prioridade | Peça | Critério |
|---|---|---|
| 1 | Decisão recorrida | a última `SENT`, ou a última `DESPADEC` quando não há sentença |
| 2 | Recurso | a peça de apelação ou agravo posterior à decisão (código a descobrir) |
| 3 | Petição inicial | `INIC` |
| 4 | Contestação | `CONT` |

As outras peças ficam desmarcadas, mas disponíveis.

**Por que essa prioridade:** `recortar_caso` (`src/rag/grafo.py`) lê só os primeiros `max_chars_caso`
caracteres (hoje 20.000, em `config_rag.json`). A ordem do texto é a da prioridade, não a cronológica, para
que o corte, se acontecer, leve o que menos importa. O contador no painel mostra o total em relação ao
limite. Se passar, avisa: "O sistema lê só os primeiros 20 mil caracteres; o final da contestação ficará de
fora."

Formato do texto montado:

```
PROCESSO 5001234-56.2020.8.24.0023 — APELAÇÃO CÍVEL — 6ª Câmara de Direito Comercial
Relator: ...   Assuntos: ...
Polo ativo: ...   Polo passivo: ...

=== DECISÃO RECORRIDA — SENTENÇA (evento 45, 10/03/2025) ===
...
=== RECURSO — APELAÇÃO (evento 52) ===
...
```

O texto continua sendo "caso do usuário" para o pipeline. Ele já passa por `cercar()` nos prompts, então peça
vinda do eproc não vira instrução.

## Sugestão de cérebro

**[DECIDIR]** No 2º grau, a capa traz o relator. Se o nome dele bater com o `nome` de um cérebro ativo
(`GET /api/cerebros`, comparando sem acento e sem caixa), o painel pré-seleciona esse cérebro e mostra "Relator
do processo". Se não bater, fica o padrão e aparece um aviso: "O relator deste processo (X) não tem cérebro no
sistema; a análise usa o perfil de Y." Não há adivinhação por nome parecido.

## Backend

- **Nenhum endpoint novo.** Usa `/api/extrair`, `/api/consultas`, `/api/consultas/{thread}/eventos` e
  `/api/cerebros`.
- **[DECIDIR]** Guardar a origem: o `POST /api/consultas` aceita um campo opcional `origem` =
  `{"eproc": "<20 dígitos>", "instancia": "1g" | "2g"}`, gravado junto da consulta. Serve para o site mostrar
  "veio do eproc, processo X" e é pré-requisito do subprojeto E. É uma mudança pequena em `api/app.py` e em
  `api/execucao.py`.

## Privacidade

Nova linha na `/privacidade`: "Ao usar **Analisar**, enviamos ao nosso servidor o texto das peças que você
marcou, a capa do processo e os nomes das partes. CPF, CNPJ e OAB são removidos antes do envio. Processos e
documentos em sigilo nunca são enviados. O texto é processado por provedores de modelo de linguagem para
gerar a análise."

## Erros novos

| Erro | Mensagem | Ação |
|---|---|---|
| `DOC_2FA` | "O eproc pediu confirmação para abrir documentos. Abra um documento manualmente na aba do eproc e tente de novo." | Focar a aba e tentar de novo |
| Nenhuma peça marcada | "Marque ao menos uma peça." | – |
| 415 do `/api/extrair` | a mensagem da API (por exemplo, RTF não suportado) | Desmarcar a peça |

Uma peça que falhou não derruba a montagem: ela sai do texto e o painel diz qual ficou de fora e por quê.

## Testes

- `node --test`: parse da capa, dos eventos com duas páginas e da lista de documentos com sigilo misto;
  pré-seleção (processo com e sem sentença, com e sem recurso); montagem em ordem de prioridade e contador;
  remoção de CPF, CNPJ e OAB (inclusive o CNPJ alfanumérico); casamento de relator com cérebro (com acento,
  sem acento, relator sem cérebro).
- Fixtures fictícias extraídas dos HARs do TJSC.
- A partir daqui vale o teste ponta a ponta com Chromium e um eproc falso servido do HAR. Decidir no plano se
  o Playwright volta só como dependência de desenvolvimento.
- Checklist manual: um processo real do 1º grau e um do 2º grau, até o prognóstico.

## Pendências do subprojeto 0

- URL assinada para abrir um processo que não está na aba.
- Formato de `processo_selecionar_pagina`.
- Resposta de `acessar_documento` e o comportamento do 2FA.
- Códigos de tipo de documento no TJSC (recurso, contestação).
- Seletores da capa no eproc do TJSC, no 1º e no 2º grau.
