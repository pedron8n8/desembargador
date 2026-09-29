# Extensão eproc — pedidos sob demanda durante a consulta (subprojeto E)

Data: 29/09/2026. Status: **rascunho**. As decisões marcadas **[DECIDIR]** precisam do seu ok. Não depende de
HAR novo, porque usa as primitivas de B.

Depende de: A e B. Usa o campo `origem` que B grava na consulta.

## Objetivo

Durante uma consulta, o próprio sistema percebe que falta uma peça (por exemplo, o caso fala de uma sentença
que não foi incluída) e pede à extensão que busque essa peça no eproc, sem o advogado ter de refazer a
montagem.

## Decisões

- **[DECIDIR] Só para consultas que vieram do eproc.** Sem `origem.eproc` não existe processo a consultar, e o
  grafo segue como hoje.
- **[DECIDIR] Um único tipo de pedido na v1: peça faltante**, escolhida de uma lista fechada: decisão
  recorrida, recurso, petição inicial, contestação. Nada de pedido em texto livre do LLM para o eproc: o LLM
  lê texto não confiável (o caso), e deixar o conteúdo dele decidir o que a extensão busca abriria a porta
  para injeção.
- **[DECIDIR] Um momento só: logo depois da triagem**, uma vez por consulta. Não é um laço.
- **[DECIDIR] Nunca trava.** Se o painel estiver fechado, se o advogado não responder, se a busca falhar ou se a
  peça for sigilosa, a consulta segue sem a peça depois do prazo (2 minutos) e o relatório diz o que faltou.
- **[DECIDIR] O advogado confirma.** O painel mostra "A análise pediu a sentença do evento 45. Buscar?" com
  **Buscar** e **Seguir sem**. Nada sai do eproc sem um clique, pela mesma lógica de B.

## Desenho

### Grafo (`src/rag/grafo.py`)

- `P_TRIAGEM` ganha o campo `pecas_faltantes`: uma lista contendo apenas valores da lista fechada. Qualquer
  outro valor é descartado no código.
- Nó novo `buscar_eproc`, entre `triagem` e `recuperar`, e só quando `origem.eproc` existe e
  `pecas_faltantes` não está vazia:
  - chama `interrupt({"tipo": "peca_faltante", "pecas": [...]})` do LangGraph. O checkpointer `SqliteSaver`
    já existe, então a pausa sobrevive a um reinício do servidor;
  - ao retomar, recebe `{"pecas": [{"tipo", "texto"}], "faltaram": [...]}`, acrescenta as peças ao caso (na
    mesma ordem de prioridade de B e dentro de `cercar`) e segue;
  - grava em `Estado` o que foi pedido, o que chegou e o que faltou, e isso sobe para o relatório.
- Sem `origem.eproc`, a aresta `triagem → recuperar` continua como hoje.

### Execução (`api/execucao.py`)

- Estado novo de execução: `aguardando_eproc`. Ele não conta no teto de consultas vivas, porque não ocupa
  worker.
- Evento SSE novo `pedido_eproc`, com as peças pedidas.
- Um temporizador de 2 minutos: se nada chegar, retoma com `faltaram` igual a tudo o que foi pedido.
- `reconciliar()` no boot trata `aguardando_eproc` antigo como vencido e retoma sem as peças.

### API (`api/app.py`)

- `POST /api/consultas/{thread}/eproc` com o corpo acima. Dono da consulta ou 403. Só aceita quando a execução
  está em `aguardando_eproc`, senão 409. Aplica o mesmo teto de tamanho do caso (`MAX_CHARS_CASO`).

### Painel

- Durante uma consulta, o painel já está inscrito no SSE (subprojeto B). Ao receber `pedido_eproc`, mostra a
  confirmação. Em **Buscar**, localiza as peças nos eventos (a mesma pré-seleção de B), baixa com
  `documento(ref)`, converte (HTML na aba, PDF por `/api/extrair`) e faz o POST.
- Se o painel for fechado, nada acontece e o temporizador resolve.

## Riscos

- O LLM pede peça sem necessidade → mais uma interação para o advogado. Mitigação: a lista é fechada, há um só
  momento, e medimos no bench quantas vezes o pedido aparece.
- Custo: a peça extra aumenta o caso. Mitigação: o mesmo `max_chars_caso` e o mesmo contador.

## Testes

- Self-check em `grafo.py` (estilo do projeto): `pecas_faltantes` com valor fora da lista é descartado; sem
  `origem` o nó não roda; retomar com `faltaram` preenchido segue e registra.
- `api/smoke.py`: `POST /eproc` fora de `aguardando_eproc` → 409; de outro usuário → 403; temporizador vencido
  retoma.
- `node --test`: tratamento do evento `pedido_eproc` no painel (buscar, seguir sem, peça sigilosa).
