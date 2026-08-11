# Scraper de Decisões TJSC — por Desembargador (Relator)

Coleta **todas as decisões de um desembargador do TJSC** cruzando duas fontes:

| Fonte | O que traz | Como |
|---|---|---|
| **Portal de Jurisprudência TJSC** | ementa, inteiro teor, documento (RTF/PDF), relator, órgão, classe, data de julgamento | HTTP direto no endpoint `buscaajax.do` filtrando por relator |
| **API Pública Datajud (CNJ)** | metadados oficiais: classe, assuntos, órgão julgador, data de ajuizamento, **todos os movimentos** | REST/Elasticsearch com paginação `search_after` |

O cruzamento usa o **número único CNJ** (20 dígitos) como chave. Nada é descartado:
registros presentes em só uma fonte entram no consolidado com a coluna `fontes` indicando
a origem, e `proveniencia_json` diz de qual fonte veio **cada campo**.

> **Sem navegador.** A pesquisa avançada do portal dispara um endpoint AJAX que devolve
> HTML puro, então a coleta usa só `requests` — sem Playwright, sem Chromium, sem seletores
> de CSS para quebrar. Única dependência: `requests`.

## Como rodar

> **Passo a passo completo — instalação, web, contas e o que fazer quando dá
> errado — está em [COMO_RODAR.md](COMO_RODAR.md).** O que segue aqui é só a
> coleta.

1. Edite `config.json` e preencha `"relator"` (o nome como aparece no portal).
2. **Dê dois cliques em `run.bat`.** Ele checa o Python, cria a venv, instala a dependência
   e inicia a coleta.
   - Também aceita parâmetros: `run.bat "Nome do Relator" 2020-01-01 2024-12-31`
3. Acompanhe o progresso no console e em `output/logs/`.

> Requer Python 3.10+ ([python.org/downloads](https://www.python.org/downloads/), marcando
> "Add Python to PATH"). O `run.bat` avisa se não encontrar.

### Quanto tempo demora

Para um desembargador com ~20 mil decisões (caso do Des. Rubens Schulz):

| Fase | Requisições | Tempo medido |
|---|---|---|
| Listagem (metadados + ementa) — 20.428 decisões | ~600 | ~18 min |
| Datajud por processo — 12.478 processos, em lotes de 50 | ~250 | ~30 min |
| Inteiro teor + documentos | ~41.000 | ~12 h |

Tudo é **retomável**: pode fechar a janela e rodar de novo que continua de onde parou.
Para só a parte rápida, ponha `"baixar_inteiro_teor": false` e `"baixar_documentos": false`.

## Configuração (`config.json`)

| Chave | Significado |
|---|---|
| `relator` | Nome do desembargador como aparece no portal (obrigatório) |
| `data_inicio` / `data_fim` | Intervalo AAAA-MM-DD; vazio = tudo |
| `fontes.portal` / `fontes.datajud` | Liga/desliga cada fonte |
| `portal.categorias` | Bases pesquisadas — ver tabela abaixo |
| `portal.ps` | Resultados por página. **Só 10, 20 ou 50 são aceitos** pelo portal; qualquer outro valor vira 20 |
| `portal.limite_fatia` | Tamanho máximo de uma fatia antes de subdividi-la (ver "Fatiamento" abaixo) |
| `portal.ano_inicio` / `ano_fim` | Faixa de anos varrida no fatiamento (`ano_fim: 0` = ano atual + 1) |
| `portal.baixar_inteiro_teor` | Fase 2: baixa o texto completo de cada decisão (1 request cada) |
| `portal.baixar_documentos` | Fase 2: baixa o arquivo do acórdão (o TJSC serve **RTF**, não PDF) |
| `portal.buscar_em_inteiro_teor` | `false` = busca na ementa (padrão do portal); `true` = busca no inteiro teor |
| `datajud.modo` | `por_processo` (padrão), `bulk_orgao` ou `hibrido` — ver abaixo |
| `datajud.orgao_julgador` | Gabinete para o modo bulk (ex.: `"Gab. 04 - 6ª Câmara de Direito Comercial"`) |
| `*.delay_segundos` | Rate limiting — seja conservador |

### Categorias do portal (`portal.categorias`)

| Chave | Base |
|---|---|
| `acordaos` | Acórdãos do Tribunal de Justiça |
| `decmonos` | Decisões monocráticas do Tribunal de Justiça |
| `recurso` | Acórdãos das Turmas Recursais e de Uniformização |
| `acma` | Acórdãos do Conselho da Magistratura |
| `despachos` | Despachos das Vice-Presidências |
| `dmtrs` | Decisões monocráticas das Turmas Recursais |

### Estratégia Datajud (`datajud.modo`)

A API do Datajud **não tem campo "relator" pesquisável**. Por isso:

- `por_processo` (padrão) — consulta o Datajud pelo número de cada processo achado no
  portal. Preciso: traz os movimentos e metadados só dos processos do relator;
- `bulk_orgao` — baixa **todos** os processos de um `orgao_julgador` via `search_after`.
  No 2º grau o Datajud registra o **gabinete** (ex.: `"Gab. 04 - 6ª Câmara de Direito
  Comercial"`), então filtrar pelo gabinete do desembargador equivale a filtrar por relator.
  Para descobrir o gabinete certo, rode primeiro o portal e veja qual gabinete aparece
  nos processos dele no Datajud;
- `hibrido` — faz os dois.

### Chave da API do Datajud

A chave pública é divulgada pelo CNJ em <https://datajud-wiki.cnj.jus.br/api-publica/acesso>.
A atual já vem no `config.json`. Se der HTTP 401/403, pegue a nova nessa página e atualize
o `config.json` (ou copie `.env.example` para `.env` e ponha ali — o `.env` tem precedência).

## Saídas (`output/`)

```
output/
├── tjsc.db            # SQLite (banco principal)
├── exports/           # espelho de cada tabela em .jsonl e .csv
├── documentos/        # inteiro teor baixado (.rtf/.pdf), nomeado pelo nº do processo
└── logs/              # log de cada execução
```

### Schema (SQLite)

- **decisoes** — uma linha por decisão do portal. `id` é uma chave interna estável; a
  identidade real é `UNIQUE (fonte, categoria, numero_processo_raw, data_julgamento, hash)`
  — pelo conteúdo, porque o `doc_id` do portal é volátil (ver abaixo).
  Guarda `numero_processo` (20 dígitos), `numero_processo_raw`
  (numeração original — processos antigos das Turmas de Recursos usam o formato pré-CNJ,
  ex.: `2013.200692-5`), `ementa`, `inteiro_teor`, `doc_path`, e mais:
  - `detalhe_em` — quando a fase 2 foi tentada (`NULL` = ainda pendente);
  - `detalhe_nota` — `segredo_de_justica` quando o portal exige login para o inteiro teor,
    `sem_conteudo` quando devolve vazio. A ementa e os metadados continuam salvos nesses casos.
- **processos** — metadados do Datajud. PK `(numero_processo, fonte)`. `raw_json` guarda o
  hit Elasticsearch completo, nenhum campo se perde.
- **movimentos** — todos os movimentos processuais do Datajud, com complementos.
- **consolidado** — uma linha por processo, campos das duas fontes, `qtd_decisoes`
  (um processo pode ter acórdão + monocrática + embargos), `fontes` e `proveniencia_json`.
- **checkpoints** — cursores de resume (por categoria do portal e do bulk do Datajud).

## Robustez

- **Atualizar depois**: rodar de novo apenas *retoma* o que ficou pendente. Para buscar
  decisões novas publicadas desde a última coleta, use `run.bat` com a coleta já feita e
  rode `.venv\Scripts\python -m src.main --recoletar`: ele varre tudo outra vez e apenas
  atualiza/insere, sem duplicar nada.
- **Resume**: a listagem grava as fatias concluídas de cada categoria; a fase de detalhes é
  retomável por natureza (só busca o que ainda falta no banco); o Datajud guarda o último
  cursor `search_after`. Para recomeçar do zero, apague `output/tjsc.db`.
- **Não sobrescreve trabalho**: repetir a listagem atualiza os metadados mas **não apaga**
  o inteiro teor nem os documentos já baixados (UPSERT seletivo).
- **Dedup**: chave natural `(fonte, doc_id)` + hash SHA-256 do conteúdo.
- **Retry**: backoff exponencial em HTTP 429/5xx e erros de rede.
- **Disjuntor**: se um endpoint cai de vez (o `integra.do` já passou horas devolvendo
  HTTP 500), insistir custa ~30 s por item em retries e só castiga um servidor que já
  está mal. Após `falhas_seguidas_ate_desistir` falhas seguidas o script desiste **daquele
  endpoint** nesta execução e segue com o outro — na prática, continua baixando o inteiro
  teor e deixa só os documentos pendentes. Basta rodar de novo mais tarde.
- **Resultado parcial nunca é descartado**: se o inteiro teor vem mas o documento falha,
  o teor é gravado e só o documento fica pendente.
- **Bloqueio/captcha**: o WAF do TJSC responde HTTP 200 com página de captcha; o script
  detecta, pausa 60 s e tenta de novo, sem travar a execução.

## Detalhes do portal que valem saber

Descobertos inspecionando o site — estão comentados no topo de `src/portal_jurisprudencia.py`:

- **Fatiamento (o ponto mais importante).** Paginar direto os 14.662 acórdãos (294 páginas)
  *perde dados*: o índice reordena os resultados entre uma página e outra, e itens somem —
  medimos ~5,5% de perda perto da página 230. O filtro de data, em compensação, é exato: a
  soma dos totais ano a ano bate **na mosca** com o total geral. Por isso a coleta fatia a
  busca por ano (e por mês quando o ano passa de `limite_fatia`) e pagina cada fatia rasa.
  Se ainda assim uma fatia vier incompleta, o script repassa por ela automaticamente.
- A paginação vai até o fim (294 páginas de 50). Passar da última página faz o portal
  **voltar à primeira**, então o laço para em `ceil(total/ps)`, não em página vazia.
- Quando a busca não tem nenhum resultado, o portal simplesmente não imprime a marca de
  total — o que é tratado como zero (foi o caso de 2023, ano em que o desembargador não
  relatou na câmara).
- Cada resultado aparece uma vez como `<strong>Processo:</strong>` **depois** de removidos os
  comentários HTML (o template repete o campo dentro de um `<!-- -->`).
- **O `doc_id` do portal é um ROWID do Oracle — não serve como identidade.** Ele é o
  endereço físico da linha no banco do tribunal, e muda quando o Oracle reorganiza: a
  mesma decisão apareceu com **três ids diferentes em três listagens**. Pior, o mesmo id
  é reusado entre decisões distintas (numa fatia: 128 decisões, 128 números de processo,
  só 124 ids). Usá-lo como chave fazia a tabela crescer a cada execução *e* apagar
  decisões diferentes. Por isso a identidade é o **conteúdo** —
  `(fonte, categoria, numero_processo_raw, data_julgamento, hash da ementa)` — e o
  `doc_id` é um atributo volátil, reescrito a cada listagem porque a fase 2 precisa
  sempre do mais recente para conseguir baixar.
- **Cuidado com NULL em índice UNIQUE no SQLite**: `NULL` nunca colide com `NULL`, então
  uma coluna da chave vazia duplicaria a linha a cada execução. Todas viram `''`.
- Como consequência da chave por conteúdo, ~65 entradas que o portal lista em duplicidade
  com todos os campos visíveis idênticos colapsam numa linha só (20.428 entradas listadas
  → 20.363 decisões distintas).
- **Nem todo item tem ícone de download** (39 links para 42 itens numa página). O id
  confiável vem do botão "Inteiro Teor" (`abreIntegra`), presente em 100% dos itens e
  dentro do próprio bloco. Usar o ícone fazia o item sem ícone herdar o id do vizinho.
- Itens **em segredo de justiça** devolvem "faça login para poder visualizá-lo" no lugar do
  inteiro teor; ficam marcados em `detalhe_nota` e não são rebuscados a cada execução.
- Decisões monocráticas não têm ementa na listagem — o texto real vem da fase 2 (inteiro teor).
- O portal antigo avisa que está em transição para o novo módulo no eproc
  (<https://eproc1g.tjsc.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar>).
  Na prática ele continua servindo julgados recentes, mas se faltar conteúdo muito novo,
  é lá que ele estará.

---

# Fase 2 — "Segundo Cérebro" (LangGraph + RAG)

Dado **um caso novo**, o sistema devolve (a) um **prognóstico** de como o relator
decidiria, com os precedentes dele que sustentam esse prognóstico, e (b) uma
**minuta** redigida no estilo dele, ancorada nesses precedentes.

```bat
consultar.bat caso.txt
consultar.bat caso.txt --so-prognostico        REM para antes de redigir (mais barato)
```

Na primeira execução ele constrói o índice de busca (≈3 min, uma vez só).
Precisa de uma chave do OpenRouter no `.env`:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

## O grafo

```
caso -> [triagem] -> [recuperar] -> [triar] -> ?suficiente? --não--> [recuperar]
                                                    |sim
                                              [prognóstico]   (sem LLM)
                                                    v
                                        [redigir] <--não-- ?aprovado?
                                             v                   ^
                                         [revisar] --------------+
                                             |sim
                                          [julgar]   (LLM-as-a-judge)
                                             v
                                            FIM
```

Dois ciclos — é o que justifica LangGraph em vez de um script linear. Se a
triagem aprovar menos de 3 precedentes, a busca refaz com o leque aberto (sem
filtro de classe, o dobro de candidatos). Se o revisor reprovar a minuta, ela
volta para o redator com a lista de problemas.

**O nó de prognóstico não usa LLM de propósito.** É contagem ponderada sobre os
rótulos do classificador, que foram validados na fase 1, mais o Random Forest da
fase 3. É a parte auditável do sistema; a minuta é a parte que pode errar — por
isso passa por um revisor de outro fornecedor.

A partir da fase 3, `[recuperar]` busca o dobro de candidatos e reordena pela
ficha de procedência antes de cortar: o LLM de triagem vê os **40 melhores de
80**, não os 40 primeiros do BM25. O custo de LLM não muda — quem paga o dobro é
o SQLite, em milissegundos.

Cada consulta fica gravada em `output/rag_runs.db` (checkpoint do LangGraph):
repetir com o mesmo `--thread` retoma de onde parou, sem repagar as chamadas
que já saíram.

## Multi-agente: um modelo por nó

Trocar em `config_rag.json` é a única mudança necessária para testar outro arranjo.

| Nó | Modelo padrão | US$/Mtok (in/out) | Por quê |
|---|---|---|---|
| `triagem` | `openai/gpt-5.6-luna` | 0,10 / 0,60 | extrai um JSON curto; é o mais barato que ainda escreve português direito |
| `triar` | `google/gemini-3.5-flash-lite` | 0,30 / 2,50 | lê ~40 ementas (entrada grande) e devolve só notas (saída minúscula) |
| `redigir` | `anthropic/claude-sonnet-5` | 2,00 / 10,00 | define a qualidade **e 90% do custo** — é o alvo do bench (ver adiante) |
| `revisar` | `x-ai/grok-4.3` | 1,25 / 2,50 | **de propósito de outro fornecedor que o redator** — crítica independente é o ponto do multi-agente |
| `juiz` | `openai/gpt-5.6-terra` | 1,00 / 6,00 | é o instrumento de medida; fornecedor distinto de todos os outros nós |

Custo típico de uma consulta completa: **US$ 0,15 a 0,25**. O relatório de saída
traz a conta real por nó (vinda do próprio OpenRouter, não estimada).

## Quanto isso acerta — o teste de honestidade

```bat
.venv\Scripts\python -X utf8 -m src.rag.avaliar --offline -n 400
```

Sorteia 400 decisões de mérito já julgadas (2024 em diante, todas classificadas
pelo dispositivo), **esconde cada uma do índice** e alimenta o sistema só com os
segmentos da ementa que descrevem o caso — filtrando fora os que entregam o
desfecho, senão o teste seria trapaça. Custo zero: não passa por LLM nenhum, é a
espinha do RAG (recuperação + contagem) medida sozinha. Se esse número for ruim,
nenhum modelo salva.

| Métrica | Resultado |
|---|---:|
| Acerto exato do rótulo | 73,2% |
| Chutar sempre "desprovido" | 67,5% |
| **Quando prevê reforma, acerta** | **72,4%** |
| Taxa real de reforma na amostra | 32,5% |
| **Ganho sobre a linha de base** | **2,23×** |
| Das reformas reais, quantas pega (recall) | 48,5% |

**Leia assim: o acerto bruto é quase inútil e a previsão de reforma é o produto.**
Como 2 em cada 3 decisões são "desprovido", quem chuta sempre desprovido acerta
67,5% sem saber nada — os 73,2% do sistema mal superam isso. Mas quando ele diz
*"esse aqui ele reforma"*, acerta 72% das vezes contra uma taxa base de 32%. Vale
mais que o dobro do chute. O inverso não vale: "ele mantém" é quase só o prior.

Ele deixa passar metade das reformas (recall 48,5%). Um caso que o sistema não
sinaliza **não** é um caso que ele manteria.

Duas escolhas de projeto saíram desse teste, não de intuição:

- **Ponderar pelo BM25.** Precedente mais próximo pesa mais no prognóstico. Sobe a
  precisão de ~69% para 72–76%. Ponderar por posição no ranking (1/i) foi pior.
- **Não filtrar por classe processual.** Testado nos mesmos 400 casos, filtrar dá
  resultado igual ou pior — o filtro joga fora casos análogos que chegaram por
  outra via recursal. `--classe` continua disponível como override manual.

Variar `k` entre 5 e 20 mexe pouco (ganho fica entre 2,1× e 2,35×): o sinal é
robusto à configuração.

# Fase 3 — Procedência, re-ranking e um segundo estimador

Três buracos da fase 2, tapados sem gastar um centavo de LLM: o prognóstico vinha
de **um estimador só**, a ordenação dos precedentes **só olhava texto**, e o
relatório não dizia **de onde vem** o que sustenta cada argumento.

```bat
treinar.bat                                                     :: treina o 2o estimador
.venv\Scripts\python -X utf8 -m src.rag.avaliar --offline -n 400 --comparar
```

## Os cinco arranjos, nos mesmos 400 casos cegos

| arranjo | exato | precisão de reforma | recall | F1 | ganho |
|---|---:|---:|---:|---:|---:|
| k-NN (fase 2) | 73,2% | 72,4% | 48,5% | 58,1% | 2,23× |
| k-NN + re-rank | 74,5% | 73,9% | 50,0% | 59,6% | 2,27× |
| Random Forest sozinho | 50,5% | 39,3% | 94,6% | 55,5% | 1,21× |
| conjunto | 73,2% | 68,0% | 63,8% | 65,9% | 2,09× |
| **conjunto + re-rank** (padrão) | **74,5%** | **71,2%** | **68,5%** | **69,8%** | **2,19×** |

Linha de base: 32,5% de reforma na amostra.

**A floresta sozinha é ruim e mesmo assim vale a pena.** Ela erra 6 em cada 10
vezes que grita "reforma" — mas quase não deixa reforma passar (recall 94,6%),
que é exatamente onde o k-NN é cego (48,5%). São errados em direções opostas.
Juntos, o F1 sobe de 58,1% para 69,8%: **troca 1,2 pp de precisão por 18,5 pp de
recall.** Se você preferir o contrário, `"peso_knn": 0.7` no config dá precisão
de 77,0% com recall de 59,2% — o peso 0,5 é o pico de F1, varrido nos mesmos
400 casos.

### O número que eu tive que jogar fora

A primeira versão da floresta marcou **93,9% de acerto e 99,6% de recall**. Não
existe previsão judicial com esses números. A ementa termina concluindo — "PLEITO
CONHECIDO E ACOLHIDO." — e é dessa frase que o rótulo saiu: o modelo estava
copiando a resposta, não prevendo. O filtro que já protegia o teste cego virou
`classificador.sem_vazamento()` e agora protege também o treino, com um `assert`
que roda **antes** de qualquer métrica aparecer na tela. Os 49,2% de precisão que
sobraram no teste temporal são o número real.

## Re-ranking: o que parece com o caso × o que vale mais

O BM25 só vê texto. Para ele, um acórdão de 2011 superado e um de 2025 ancorado
em tema repetitivo empatam se as palavras baterem igual. Os sinais da ficha
entram como multiplicadores em cima do score que já foi medido:

```
pontos = |bm25| × recência × âncora × unanimidade × efeito × seu feedback
                  ½ a cada    1,35 se  0,85 se não  1,10 se     teto ±30%
                  6 anos      vincula  unânime      transitou
```

Ganho pequeno e consistente (+1,4 pp de precisão, +1,6 pp de F1). Nada aqui
**inventa** relevância — tudo modula a que o BM25 achou, e o relatório imprime o
fator de cada precedente ("idade 0,89 · âncora vinculante 1,35 → 1,32×").
`"rerank": {"ativo": false}` devolve o comportamento da fase 2.

## As cinco perguntas de procedência

O relatório passa a responder, com dados e não com opinião do modelo:

| pergunta | resposta | de onde sai |
|---|---|---|
| Qual a idade do documento? | ano de julgamento, com decaimento de meia-vida de 6 anos | `data_julgamento` |
| Quantas vezes o argumento já foi usado, onde e por quem? | nº de usos, período, taxa de reforma, top classes / câmaras / comarcas | 1 agregação FTS5 (131 ms) |
| Vale nacional ou só estadual? | **vinculante** (tema repetitivo, IRDR, repercussão geral, súmula vinculante) / **persuasiva** (súmula, REsp) / **estadual** | regex no inteiro teor |
| Já existe contra-argumentação? | precedentes recuperados que decidiram para o lado oposto + os não-unânimes do acervo | resultado do classificador + "por maioria"/"vencido" |
| Existe efeito público? | transitou em julgado / subiu para STJ-STF / sobrestado | 994 mil movimentos do Datajud |

No acervo: **14,5% vinculante, 50,8% persuasiva, 34,7% estadual**; 3,6% com
divergência interna; **55,9% com efeito posterior** no Datajud.

**"Em quais estados" não é respondível e o relatório diz isso.** O acervo é 100%
TJSC. Dá para afirmar que um argumento ancorado em tema repetitivo do STJ vincula
o país inteiro; não dá para dizer o que o TJSP faz com ele. Estimar isso seria
inventar autoridade num campo que parece autoritativo.

Empate também é respondido como empate: quando os precedentes se dividem metade
a metade, não há "lado majoritário" — dizer que há seria afirmar uma tendência
que os dados não mostram.

## Decisão mútua

| situação | o que sai |
|---|---|
| concordam | o resultado, com os dois números lado a lado |
| **divergem** | os dois aparecem, e o redator recebe ordem expressa de **enfrentar os dois lados** — não de escolher um em silêncio |
| a busca não trouxe precedente | a floresta responde sozinha (**é o fallback**), marcada como o estimador mais fraco |
| sem `scikit-learn` instalado | k-NN sozinho, idêntico à fase 2 |

O k-NN continua sendo o número **primário**: dá para apontar quais 8 decisões o
produziram. A floresta é opaca por natureza — não se cita "os 400 galhos que
votaram assim" numa peça. Ela entra como segunda opinião e rede de segurança.

Uma ressalva honesta sobre o fallback: nos 400 casos de teste ele **nunca
disparou** (a busca sempre trouxe alguma coisa). O código existe e o self-check
o cobre, mas essa medição não o exercitou.

# Fase 4 — Evidência primeiro: o sistema que sabe quando não sabe

Até aqui o sistema **sempre respondia**, e o percentual que ele imprimia não
significava o que parecia significar. As duas coisas foram consertadas, e a
segunda é o que muda o produto: **quando os dados não sustentam um prognóstico,
o relatório diz `NÃO DECIDO` e entrega as evidências assim mesmo.**

```bat
.venv\Scripts\python -X utf8 -m src.rag.deriva              REM auditoria de época
.venv\Scripts\python -X utf8 -m src.rag.calibrar --ajustar  REM isotônica
```

## O número agora significa o que diz

O prognóstico ordenava bem e mentia na escala. Medido em 1.092 decisões de 2025:

| o sistema dizia | reformavam de verdade | depois da calibração |
|---|---:|---:|
| 0–20% | 4,1% | **4,6%** (previsto 4,3%) |
| 20–40% | 9,9% | **24,0%** (previsto 28,9%) |
| 40–60% | 40,3% | **52,2%** (previsto 50,5%) |
| 60–80% | 75,2% | **72,5%** (previsto 69,8%) |
| 80–100% | 97,7% | **93,4%** (previsto 97,1%) |

Regressão isotônica ajustada em **1.200 decisões de 2024**, validada em **1.092
de 2025 que não entraram no ajuste**. Brier 0,158 → 0,138; maior erro da
diagonal **21,9 pp → 5,0 pp**.

O corte é temporal e não aleatório de propósito — ver a auditoria de deriva
abaixo. E o resultado é limitado a [1%, 99%]: "0% de chance" não é estimativa,
é promessa.

## Saber calar é o que leva a 96%

Medido nos mesmos 400 casos cegos, na escala **calibrada** — a que o usuário vê:

| regime | responde em | acerta |
|---|---:|---:|
| sempre (fase 3) | 100,0% | 80,2% |
| margem ≥ 0,20 | 64,2% | 89,5% |
| margem ≥ 0,25 | 46,0% | 94,0% |
| margem ≥ 0,30 | 41,8% | 95,2% |
| **margem ≥ 0,35 (padrão)** | **37,8%** | **96,7%** |
| margem ≥ 0,45 | 29,0% | 96,6% |

O preço de chegar a 96,7% é não responder em 62% das consultas. Nesses casos o
dossiê de evidências sai completo — só o veredito não sai.

**Uma armadilha que a regra de aceite pegou.** O corte foi escolhido primeiro na
escala bruta (0,20 dava 37% de cobertura e 95,3%). Mas a calibração *estica* a
escala: o mesmo 0,20 passou a pegar 64% dos casos, e a faixa caiu para 89,5% —
abaixo dos 93% que estavam escritos como critério antes de rodar. O corte foi
remedido na escala calibrada e subiu para 0,35, que reproduz a cobertura
escolhida (37,8%) com acerto ainda maior. Sem o critério escrito de antemão, o
número ruim teria passado.

Quatro sinais foram testados como medida de incerteza (acerto por tercil):

| sinal | baixo | médio | alto | veredito |
|---|---:|---:|---:|---|
| margem \|p−0,5\| | 70,5% | 75,8% | 95,6% | **é o portão** |
| concordância dos precedentes | 71,2% | 79,5% | 91,2% | rebaixa |
| força do melhor precedente | 75,8% | 80,3% | 86,0% | rebaixa |
| desacordo k-NN × floresta | 87,9% | 79,0% | 75,0% | rebaixa (invertido) |
| **desvio entre as 400 árvores** | 67,4% | 85,0% | 89,6% | **descartado** |

O desvio-padrão entre as árvores era o candidato óbvio a barra de erro. Ele mede
o **contrário** do esperado — árvores discordando muito acompanha *mais* acerto.
Ficou de fora. O intervalo publicado vem de reamostragem sobre os precedentes,
que é de onde a incerteza realmente vem: a conta sai de 8 decisões que poderiam
ter sido outras 8.

Os três sinais secundários só **rebaixam**. Um sinal fraco não promove o que o
sinal forte reprovou.

## O humor do desembargador aparece nos dados?

`python -m src.rag.deriva` — a pergunta merecia medição, não suposição.

| eixo | variação | leitura |
|---|---|---|
| **dia da semana** | **1,99 pp** | Não há efeito de segunda-feira. Esta é a boa notícia. |
| **ano a ano** | 28,0% a 38,9% (~11 pp) | **É aqui que está a variação real.** Não é humor: é jurisprudência que consolida e lei que muda. |
| carga do dia | 4,88 pp → **1,00 pp** ao controlar por tipo | Era composição, não cansaço: dia de poucas decisões é dia sem sessão. |
| âncora citada | vinculante 38,6% vs estadual 32,2% | Sinal jurídico e estável — é o tipo de variação que o sistema **deve** usar, e usa. |

Consequência de projeto: o inimigo não é o humor de curto prazo, é a **deriva de
época**. Por isso o calibrador é ajustado em janela recente, e por isso o
relatório avisa que a base histórica de duas décadas **não descreve o tribunal
de hoje**.

## A estatística virou input da IA

O triador (o LLM que dá a nota de analogia) via só a ementa. Agora vê a ficha de
cada candidato — idade, âncora, unanimidade, efeito no Datajud — com uma regra
explícita: **entre dois precedentes igualmente análogos, vence o mais bem
ancorado e mais recente**; mas âncora forte em questão jurídica diferente
continua valendo 1 ou 2. Custo praticamente igual (~40 tokens por candidato).

E quando o sistema não decide, o redator recebe instrução de **não afirmar
desfecho provável**: escreve os dois caminhos, cada um com seus precedentes, e
abre uma seção final apontando o ponto concreto de que o caso depende.

## A ordem do relatório mudou

Evidências → o que corta contra → só então o prognóstico → minuta.

Não é estética. Quem lê um percentual primeiro ancora nele e lê o resto
procurando confirmação. O número vem por último para ser lido como conclusão, e
não como premissa.

## Duas coisas que a primeira consulta real quebrou

A abstenção funcionou de primeira — e logo quebrou dois instrumentos de medida
que não sabiam dela.

**O juiz punia o comportamento que o sistema pediu.** Na consulta de
`exemplos/caso.txt` o sistema disse NÃO DECIDO, o redator escreveu os dois
caminhos com dispositivo condicional (como instruído), e o juiz automático deu
**2 em coerência** com o comentário: *"o dispositivo condicional não define qual
dos dois caminhos julga o recurso"* — a descrição literal do que se pediu. O
juiz agora recebe o aviso de modo e avalia se cada caminho decorre da sua própria
fundamentação.

**O bench virava ruído.** O critério que decide qual modelo escreve a minuta é
"o dispositivo bateu com o real". Com abstenção ligada, ~60% dos casos de bancada
viravam minuta de dois caminhos, sem desfecho definido para comparar com o
gabarito. Abster-se é recurso de produto, não modo de bancada: `bench.rodar()`
agora desliga a abstenção e a restaura ao sair.

**Duas coisas que eu atribuí errado, e a segunda execução desmentiu.** Eu tinha
culpado a abstenção pelas minutas truncadas. Com a abstenção desligada, a taxa
de truncamento ficou igual (4 de 6): a causa era só o teto de `max_tokens` em
8000, baixo demais para acórdãos reais. Subiu para 16000 — teto é limite, não
meta, então elevá-lo não gasta nada quando o modelo não precisa, e evita pagar
a chamada duas vezes quando precisa.

**E o bench perdia tudo se fosse interrompido.** Ele gravava `bench.json` só no
fim; uma execução morta depois do terceiro modelo jogou fora três medições já
pagas. Agora grava a cada modelo, e `--continuar` mede só o que falta.

### O bench rodou — e o resultado é "não troque nada"

32 minutas (8 modelos × 4 casos já julgados), US$ 2,54, juiz com gabarito:

| modelo | média | disp | fidel | US$ (4 casos) |
|---|---:|---:|---:|---:|
| qwen/qwen3.7-plus | 2,65 | 3,00 | 3,50 | 0,2298 |
| deepseek/deepseek-v3.2 | 2,55 | **3,50** | 2,00 | **0,1918** |
| **anthropic/claude-sonnet-5** (atual) | 2,50 | 2,25 | 3,50 | **0,6189** |
| minimax/minimax-m2.5 | 2,45 | 2,75 | 2,50 | 0,2444 |
| moonshotai/kimi-k2.5 | 2,35 | 2,75 | 2,25 | 0,3341 |
| z-ai/glm-5 | 2,30 | 1,75 | 4,25 | 0,2761 |
| z-ai/glm-4.7 | 2,25 | 1,75 | 3,00 | 0,2676 |
| moonshotai/kimi-k2-thinking | 2,10 | 2,00 | 1,25 | 0,3750 |

**Essa ordenação é ruído, e a regra escrita antes de rodar manda ignorá-la.**
A diferença entre o 1º e o último é 0,55 ponto com erro-padrão de 0,58 — **0,9
sigma**. No critério que importa (`disp`), melhor contra pior dá 1,5 sigma.
Nenhum dos dois chega perto dos 2 sigma que autorizariam uma conclusão. A
variação entre os quatro casos (2,30 a 2,65) é do mesmo tamanho da variação
entre os oito modelos.

Olhe as notas cruas de `disp` e fica claro por quê: deepseek `[4,5,4,1]`,
sonnet `[0,4,3,2]`, glm-5 `[4,0,0,3]`. Os modelos **acertam em cheio ou erram
feio** — não erram um pouco. Com n=4 isso é uma moeda.

Para distinguir 0,5 ponto com 95% de confiança seriam necessários **~27 casos
por modelo** (US$ 17 nos oito). O modelo do `redigir` **não foi trocado**.

**O achado que vale mais que o ranking:** a média geral é **2,39 de 5**. Nenhum
modelo reproduz as decisões dele bem — nem o mais caro. O gargalo não é o
modelo, e trocar de modelo é rearranjar cadeiras. E há um fato de custo que a
falta de significância não apaga: o sonnet-5 custa **3,2× o deepseek** e não
mostrou vantagem nenhuma. Provar isso de vez custa US$ 4,30 (só esses dois,
27 casos cada) — bem menos que os US$ 17 de comparar todos.

### As três tentativas que não chegaram lá

Antes de dar certo, três tentativas queimaram US$ 5,00 sem produzir uma única
comparação. Vale registrar, porque é a parte cara da lição:

| tentativa | o que aconteceu |
|---|---|
| 1ª (8 modelos × 8 casos) | abortada por mim: o juiz e o bench não sabiam da abstenção, e a medição estava confundida |
| 2ª (8 × 6) | interrompida depois de 3 modelos; sem gravação incremental, as 3 medições pagas foram perdidas |
| 3ª (8 × 4) | parou no 3º caso: crédito esgotado |

O perfil real também desmentiu a estimativa: não é 30k de entrada / **4k** de
saída, é 30,9k / **7,0k**. A saída dobrou e é ela que domina o preço — o
sonnet-5 custa **US$ 0,132** por minuta, não US$ 0,100. Os oito candidatos em
`config_rag.json` foram recalculados com o número medido.

A persistência agora é **por caso**, não por modelo: cada minuta medida vai para
`output/bench_casos.json` assim que termina, e `--continuar` nunca remede o que
já foi pago. O self-check prova isso sem gastar — se todos os casos já estão no
disco, `rodar()` não pode tocar a rede.

A execução que funcionou custou **US$ 2,54**, contra US$ 2,75 estimados.

## O bench refeito: as correções valeram +0,57 ponto, e agora dá para escolher modelo

Mesmos 4 casos, mesmos 8 modelos, só os prompts corrigidos. **Comparação pareada
— 32 minutas antes e depois:**

| modelo | antes | depois | Δ |
|---|---:|---:|---:|
| deepseek/deepseek-v3.2 | 2,55 | **3,40** | +0,85 |
| anthropic/claude-sonnet-5 | 2,50 | 3,35 | +0,85 |
| z-ai/glm-5 | 2,30 | 2,95 | +0,65 |
| z-ai/glm-4.7 | 2,25 | 2,95 | +0,70 |
| moonshotai/kimi-k2.5 | 2,35 | 2,85 | +0,50 |
| minimax/minimax-m2.5 | 2,45 | 2,85 | +0,40 |
| qwen/qwen3.7-plus | 2,65 | 2,75 | +0,10 |
| moonshotai/kimi-k2-thinking | 2,10 | 2,60 | +0,50 |
| **média geral** | **2,39** | **2,96** | **+0,57** |

**8 de 8 modelos melhoraram.** No teste pareado (26 minutas melhores, 5 piores,
1 empate): diferença de +0,569 com erro-padrão de 0,144, **t = 3,96** — bem
acima dos 2 sigma. Isto **é** significativo, ao contrário do ranking anterior.
Comparação pareada é muito mais sensível: o ruído do caso se cancela porque cada
minuta é comparada consigo mesma.

O vazamento do prognóstico foi a zero:

| | antes | depois |
|---|---:|---:|
| prognóstico citado dentro do voto | 7 de 32 (6 modelos) | **0 de 32** |
| inventou premissa | 5 | 3 |
| omitiu pedido | 10 | 6 |

**E o ranking passou a ter sinal.** Primeiro contra último: 0,80 ponto com
erro-padrão de 0,37 = **2,2 sigma**. Antes eram 0,9 sigma. O ruído do prompt
quebrado estava mascarando a diferença entre os modelos.

O `deepseek-v3.2` lidera com **3,40**, à frente do sonnet-5 (3,35) que custa
3,2× mais — e mantém o melhor `disp` (3,50, o critério que decide). A troca já
feita fica confirmada pela medição, não só pelo preço. Continua sendo n=4 por
modelo: o 1º contra o 2º **não** é distinguível; o que ficou distinguível foi o
topo contra a cauda.

## Os três defeitos que o bench expôs

O ranking era ruído, mas as 32 minutas com gabarito expuseram bugs que nenhuma
inspeção teria achado.

**1. O prognóstico vazava para dentro do voto.** Em **7 das 32 minutas, com 6 dos
8 modelos**, o texto argumentava com a estatística: *"inclusão de prognóstico
estatístico estranho ao voto real"*. Nenhum acórdão diz "a estatística indica
reforma". O `P_REDIGIR` entregava o JSON do prognóstico sem dizer que era
interno — defeito meu, penalizando todos os modelos igualmente e explicando
parte da média de 2,39.

**2. A triagem truncava e o relatório saía oco.** O nó `triar` devolve uma nota
por candidato. No 2º ciclo de busca são 80 candidatos, e o teto de 2000 tokens
cortava o JSON no meio: parser devolve vazio, **nenhum** precedente passa, e a
consulta produz um relatório sem evidência alguma. Aconteceu numa consulta real.
Teto para 6000, detecção de truncamento com refação, e um aviso explícito quando
a triagem não devolve nota nenhuma. (A abstenção salvou a cara: com 0
precedentes ela disse NÃO DECIDO em vez de inventar um número.)

**3. Em modo NÃO DECIDO, a minuta cravava mesmo assim.** A instrução dizia que o
dispositivo "pode ser escrito" — ambígua. Agora exige dois cenários explícitos, e
o revisor recebe o mesmo aviso de modo que o juiz já tinha.

## Modelo trocado: deepseek-v3.2

Escolha de **custo, não de qualidade** — o bench não mostrou diferença
significativa entre os oito. Mesma consulta (`exemplos/caso.txt`), antes e
depois:

| | sonnet-5 | deepseek + prompts corrigidos |
|---|---:|---:|
| nota do juiz | 3,5 | **4,5** |
| fidelidade | 3 | **5** |
| coerência | 2 | **4** |
| custo | US$ 0,1544 | **US$ 0,0433** |

**3,6× mais barato com nota maior** — mas atenção ao ler: é um caso só, e boa
parte do ganho vem das correções de prompt, que beneficiariam o sonnet também.
O que está medido é que não há evidência de o caro ser melhor.

**Risco aceito e monitorado:** no bench o deepseek teve a 2ª pior fidelidade
(2,00, com um zero), e o juiz flagrou *"inventa o regime legal da cédula"*. Por
isso o revisor ganhou checagem específica de regime jurídico inventado. Se
aparecer citação inventada em uso real, o próximo passo é `qwen3.7-plus`
(fidelidade 3,50 por US$ 0,019), não voltar ao sonnet.

## Consulta real, ponta a ponta

`exemplos/caso.txt` — 116 s, **US$ 0,1544**, com o novo triador e a abstenção:

```
# Evidências → ## Precedentes usados → ## Procedência dos argumentos
# Prognóstico → ## NÃO DECIDO
# Minuta → ## Divergência do prognóstico → ## O que decide este caso
```

A ficha apareceu por precedente (`âncora nacional vinculante (Tema 1068/STJ) |
unânime | Datajud: transitou`) e o re-ranking explicou a própria ordem
(`idade 0.56 · âncora vinculante 1.35 · transitou 1.10 → 0.83x`). A minuta
terminou apontando o fato concreto de que o caso depende, em vez de fingir um
prognóstico.

# Fase 5 — A linha de argumentação, e a memória do que você já usou

Duas perguntas passaram a existir antes da consulta:

```
Que análise você quer deste caso?
  1) neutra     — o que o acervo diz, sem lado
  2) reformar   — puxa também os precedentes que DERAM provimento
  3) manter     — o mesmo, do lado que NEGOU provimento
  4) histórico  — processos e consultas que você já usou
```

`consultar.bat caso.txt --tese reformar` pula a pergunta. Sem terminal
(scripts, bench, avaliação) o padrão é **neutra** — nenhum número medido antes
desta fase mudou de significado.

## "Condenar/absolver" não é o eixo deste acervo

O pedido falava em condenar e absolver. Este acervo tem **18 decisões criminais
em 20.363** — é cível. O eixo que existe nos dados é outro, e é nele que a busca
opera: **reformar** (provido + parcialmente provido) contra **manter**
(desprovido), 14.657 decisões de mérito. Traduzir um pelo outro seria dar ao
sistema um vocabulário que os documentos não têm.

## O filtro por `resultado` estava errado, e o teste provou

A primeira implementação encolhia a amostra com SQL: `--tese reformar` buscava
`resultado IN ('provido','parcialmente provido')`. Rodada ponta a ponta no caso
de exemplo — em que **o apelante é o autor** — ela trouxe 8 precedentes "provido"
e a minuta saiu assim:

> *"não restou configurado o evento coberto pela apólice, sendo indevida a
> indenização pleiteada. A sentença merece ser mantida."*
> **DISPOSITIVO: NEGO-LHE PROVIMENTO**

Pedi reformar e saiu manter. Não foi desobediência: nos 8 precedentes quem
recorreu foi a **seguradora**, então "provido" ali significa *a seguradora
ganhou*. O redator foi fiel a documentos que argumentam o contrário do pedido.

**`provido` é resultado processual, não direção da tese.** E o filtro ainda
descartava o melhor material: um `desprovido` em que a parte contrária recorreu
e perdeu é exatamente o que a sua tese quer citar.

Tentei recuperar o recorrente por regex na ementa: **40,2%** das 14.657 decisões
de mérito. Não dá para filtrar em cima disso.

## Quem filtra é a triagem

A pergunta "este precedente favorece o meu lado?" só tem resposta lendo o
mérito. Quem lê é o triador, que já passa por cada candidato. Ele passou a
devolver um campo a mais:

```json
{"id": 123, "nota": 4, "por_que": "...", "lado": "a_favor|contra|neutro"}
```

Só `a_favor` chega ao redator. O prompt avisa explicitamente da armadilha do
rótulo (`um acórdão "provido" em que quem recorreu foi a seguradora é material
CONTRA um segurado`). Custo: ~5 tokens por candidato.

**As três, no mesmo caso, ponta a ponta:**

| modo | triagem | dispositivo da minuta | prognóstico |
|---|---|---|---|
| neutra | 8 de 40, sem filtro de lado | condicional (2 cenários) | 17,1% calibrado |
| reformar | **3 de 67** (63 contra, 1 neutro) | **DOU-LHE PROVIMENTO** | recusado |
| manter | **33 de 34** (0 contra, 1 neutro) | **NEGO-LHE PROVIMENTO** | recusado |

Os números do meio são o achado: para sustentar `reformar` neste caso o sistema
teve de descartar 63 precedentes análogos que decidem contra, e precisou de dois
ciclos de busca para achar 3 que sustentam. Para `manter`, 33 de 34 serviam de
primeira. **Isso é a evidência na cara do usuário** — e bate com o prognóstico
neutro de 17%. Um dos 3 de `reformar` é `prejudicado`, resultado que o filtro
SQL antigo excluía por definição.

## Sem prognóstico quando você pede um lado

Contar resultado numa amostra escolhida por sustentar um lado mede a escolha, não
o tribunal. Então no modo extremo não sai percentual nenhum: `faixa:
amostra_filtrada`, `probabilidade_pct: None`. O self-check do grafo falha se
`reforma_nos_precedentes`, `probabilidade_pct`, `reforma_conjunta_pct`,
`distribuicao` ou `intervalo_pct` aparecerem numa consulta com tese.

Sobrevive só a **floresta**, que lê o caso e não a busca — e sai crua, porque a
calibração foi ajustada sobre a escala do conjunto, que aqui não existe.

## Os pontos em comum

`sinais.comuns()` conta o que se repete entre os precedentes que sobraram —
campo indexado, sem LLM:

```
- Âncoras citadas por mais de um: Súmula n. 5 (7)
- Câmaras: Segunda Câmara de Direito Civil (8)
- 8 de 8 unânimes, 7 transitaram em julgado, anos 2019–2019
```

Quando nenhuma âncora aparece em mais de um, o relatório diz o contrário com
todas as letras: são decisões que chegaram ao mesmo resultado por caminhos
diferentes, e não há tese única para citar.

## A trava de tendência

No modo tese a minuta não pode dizer "os precedentes são uníssonos" — a contagem
mede o filtro. O revisor pega isso, mas **depende de sobrar ciclo de revisão, e
num teste real não sobrou**: a minuta final saiu com "os precedentes desta Corte
são uníssonos" listado apenas como ressalva não corrigida.

Então há uma varredura por regex no texto pronto (`cli.tendencia_no_texto`), que
não depende de modelo nenhum. Os trechos vão em destaque **antes** da minuta. A
seção "Onde esta tese é frágil" fica fora da varredura: falar de jurisprudência
dominante contrária é o propósito dela, e sem essa exceção o alerta dispararia em
toda consulta — alerta que sempre dispara é alerta que ninguém lê.

A minuta também passou a fechar com essa seção obrigatória, apontando do próprio
material o que enfraquece a tese: precedente não unânime, âncora só estadual,
fato que afasta a analogia.

## O que você já usou

```bat
consultar.bat --historico                REM tudo
consultar.bat --historico 0302503        REM por número de processo
consultar.bat --historico "seguro"       REM por tema do caso
```

Sai de `feedback.db`, que já registrava as consultas — o que faltava era
perguntar. Conta reuso (`0302503-58.2017.8.24.0008 — 4 vezes`) e mostra o
veredito que você deu a cada precedente. Os precedentes de sustentação entram
no registro junto com os neutros: para "já usei esse processo?", o que conta é
ter chegado ao redator, não por qual das duas buscas.

## Qualificar as respostas e escolher o modelo

Duas coisas ligadas: quem decide se um modelo mais barato serve é a **nota**, e
a nota só vale se o juiz automático concordar com você.

### Você qualifica

```bat
qualificar.bat                              REM a última consulta, interativo
qualificar.bat --thread X --nota 4 --inutil 8267 9112
qualificar.bat --relatorio                  REM concordância entre você e o juiz
```

Duas coisas separadas, e não confundir importa:

- **Nota da consulta (0–5)** — serve para *medir*. Guardada ao lado da nota do
  juiz, responde a pergunta que decide tudo: o juiz concorda com você? Se sim,
  dá para trocar de modelo rodando o bench sem ler minuta nenhuma. Se não, o
  juiz não vale como instrumento e o bench mente.
- **Veredito por precedente (útil/inútil)** — serve para *melhorar*. É o único
  sinal que realimenta a busca: um precedente marcado inútil desce de posição
  nas consultas seguintes, um marcado útil sobe.

O ajuste é limitado a ±30% de propósito (`TETO` em `src/rag/feedback.py`). O
BM25 foi calibrado em 400 casos cegos; deixar meia dúzia de cliques desmanchar
essa calibração seria trocar o que foi medido pelo que foi sentido. Precedente
reprovado perde posição, não some.

### O juiz automático (LLM-as-a-judge)

Roda em dois modos, e a diferença é grande:

| Modo | Quando | O que mede |
|---|---|---|
| **Com referência** | no bench — o caso já foi julgado, o gabarito existe | o quanto a minuta chegou onde ele chegou: mesmo dispositivo, mesmos fundamentos |
| **Sem referência** | consulta real, caso novo | só coerência interna e fidelidade às fontes — **não** diz se a decisão está juridicamente certa |

O modo com referência é o que vale. Ele desarma as patologias conhecidas do
juiz-LLM — viés de tamanho, de posição, autopreferência — porque a nota vira
concordância com um fato, não preferência estética. Além disso o juiz **nunca é
do mesmo fornecedor do redator julgado** (`juiz_para()` desvia para o reserva);
modelo julgando a si mesmo se dá nota alta.

### O bench de modelos

```bat
.venv\Scripts\python -X utf8 -m src.rag.bench --listar          REM só o custo estimado
.venv\Scripts\python -X utf8 -m src.rag.bench -n 8 --confirmar  REM roda (gasta)
```

Sorteia decisões já julgadas, **esconde cada uma do índice**, alimenta o grafo
com o **relatório** da decisão real — a parte que descreve o caso, entre
`RELATÓRIO` e `é o relatório`, que fica depois da ementa e antes da
fundamentação, então não vaza o desfecho — e faz o juiz comparar a minuta com a
decisão verdadeira.

> A extração tem um self-check que roda sem gastar nada
> (`python -m src.rag.bench`): confere em 400 acórdãos que a conclusão da ementa
> nunca aparece dentro do relatório extraído. Ele pegou um vazamento real — uma
> ementa que continha a expressão "RELATÓRIO MÉDICO" fazia a extração começar
> dentro da própria ementa. Por isso a âncora é a fórmula "Vistos, relatados e
> discutidos", que sempre encerra a ementa. Cobertura: 88% dos acórdãos.

Candidatos e custo por chamada no perfil real (30k tokens de entrada, 4k de
saída), todos em `config_rag.json`:

| modelo | US$/chamada | vs. atual |
|---|---:|---:|
| `anthropic/claude-sonnet-5` (atual) | 0,100 | — |
| `z-ai/glm-5` | 0,039 | 2,6× |
| `moonshotai/kimi-k2.5` | 0,029 | 3,4× |
| `moonshotai/kimi-k2-thinking` | 0,028 | 3,6× |
| `z-ai/glm-4.7` | 0,019 | 5,3× |
| `qwen/qwen3.7-plus` | 0,015 | 6,7× |
| `deepseek/deepseek-v3.2` | 0,010 | 10× |
| `minimax/minimax-m2.5` | 0,008 | 12,5× |

**Nenhum foi trocado ainda.** O preço diz que dá para gastar 12× menos; se o
português jurídico e o dispositivo se sustentam é pergunta empírica, e trocar
antes de medir seria escolher por planilha. Rodar os 8 candidatos em 8 casos
custa ~US$ 4,20 — uma vez, e resolve a questão para sempre.

O critério que decide não é a média: é a coluna **`disp`** (o dispositivo bateu
com o real). Uma minuta bem escrita com o dispositivo trocado é pior que inútil.

## Por que não tem banco vetorial

O SQLite do Python traz **FTS5** compilado, e BM25 sobre ementa + dispositivo
recupera muito bem em texto jurídico: o vocabulário é fixo e distintivo
("suscitação de dúvida", "prescrição intercorrente", "art. 557"). O ganho
semântico que embeddings dariam é coberto pelo nó de triagem, que relê os 40
candidatos e descarta o que não é análogo.

Também não caberia: o venv roda Python 3.14, e `faiss`/`chromadb` não têm wheel
confiável; a GPU da máquina tem 2 GB. Se um dia a triagem mostrar que o caso
certo não está entre os 40 candidatos, aí entra `sqlite-vec` + embeddings por API.

A ementa pesa **3×** o dispositivo no BM25: o dispositivo carrega os verbos
decisórios, que são quase iguais nas 20 mil decisões e não distinguem matéria.

## Índice (`output/rag.db`, ~70 MB)

Uma linha por decisão, com ementa limpa, dispositivo, os metadados de filtro e
(desde a fase 3) a ficha de procedência: `ancora`, `ancoras_json`, `unanime`,
`efeito`. O inteiro teor (281 MB) **não é copiado** — o nó de redação puxa os
textos completos direto do `tjsc.db` pelo mesmo `id`.

Dois cuidados na limpeza, sem os quais o BM25 pontua ruído:

- Nos **acórdãos**, a ementa termina com a citação `(TJSC, Apelação n. …, rel.
  Rubens Schulz, …)` — sai fora.
- Nas **monocráticas** o campo "ementa" nem é uma ementa: é o começo do
  documento, precedido de `Processo: … Relator: … Início do documento:` e
  truncado em `[...] voltar para pesquisa`. Corta-se as duas pontas.

## Saídas da fase 2

```
output/
├── rag.db          # índice FTS5 (reconstruível: python -m src.rag.indexar)
├── rag_runs.db     # checkpoint do LangGraph — uma linha por passo de cada consulta
├── feedback.db     # suas notas, as do juiz e o veredito por precedente
├── bench.json      # última comparação de modelos
└── consultas/      # o relatório .md de cada consulta
```

---

---

# Fase 6 — A interface

Até aqui o produto era um `.md` de 400 linhas cuspido no PowerShell. A
inteligência toda já existia como função Python importável; o que faltava era
superfície. Um advogado sênior não lê `consultar.bat` — e a parte mais valiosa
do sistema, **por que** cada precedente pesa o que pesa, estava enterrada em
texto corrido.

```bat
.venv\Scripts\python -m pip install -r requirements-web.txt
.venv\Scripts\python -m api.usuarios --criar voce@escritorio.com --papel admin
web.bat
```

Duas dependências novas no Python (`fastapi`, `uvicorn`) — `httpx`, `pydantic`,
`starlette` e `anyio` já vinham com o langgraph, e a autenticação é stdlib
inteira (`hashlib.scrypt`, `secrets`, `hmac`).

```
api/        só HTTP. Nada de lógica de domínio aqui.
frontend/   projeto Node isolado (Vite + React + TS). Sem package.json na raiz.
web.bat     sobe os dois: uvicorn na 8000, vite na 5173
```

Em dev o Vite faz proxy de `/api` para o uvicorn — same-origin, então não há
CORS nem cookie cross-site para configurar. Em produção, `npm run build` gera
`frontend/dist/` e o FastAPI o serve: um processo, uma porta, um certificado.

## O que a interface mostra que o `.md` não mostrava

| tela | o que ela responde |
|---|---|
| pipeline ao vivo | qual nó está rodando, com qual modelo, quantos tokens e quantos centavos — nó a nó, por SSE |
| painel de pesos | a cascata inteira: `\|BM25\| × idade × âncora × unanimidade × efeito × feedback = pontos`, depois `× confiança × analogia = peso final`, e a fração de cada precedente no total |
| rede de precedentes | quais decisões se apoiam na mesma súmula ou tema repetitivo |
| estatísticas | deriva de época, taxa por classe e câmara, curva de calibração, cobertura de abstenção **medida no seu uso**, livro-caixa |
| acervo | as 20.363 decisões, com a busca explicando a própria ordem |
| conversa | perguntar sobre uma consulta já feita por ~US$ 0,005, sem rodar o grafo de novo |

## A âncora é nó, não aresta

A forma óbvia do grafo de precedentes seria ligar decisão a decisão quando as
duas citam a mesma súmula. Medido: 40 candidatos produziram **466 arestas**,
porque 20 decisões que citam a Súmula 150 formam uma clique de 190. Isso não é
visualização, é novelo — e pior, esconde o fato que interessa, que é *qual*
precedente as segura. Com a âncora como nó, a mesma informação custa 20 arestas
em vez de 190, e a leitura vira a frase jurídica: "estas 20 decisões se apoiam
na Súmula 150".

E a canonização não é detalhe. O `ancoras_json` tem **1.941 rótulos distintos**
para bem menos âncoras reais, porque o mesmo verbete aparece como `Súmula 54 do
STJ`, `SÚMULA 54 DO STJ`, `Súmula n. 54` e `Súmula 54`. Sem normalizar, as
arestas de âncora simplesmente não aparecem — e o grafo sai vazio sem erro
nenhum, que é o pior modo de falhar. `src/rag/rede.py` reduz tudo a uma chave
(`sumula:54:stj`) e ainda resolve o tribunal ausente **quando não há dúvida**:
se `Súmula 150` e `Súmula 150/STF` aparecem no mesmo conjunto, viram uma coisa
só; se aparecem duas cortes com o mesmo número, a citação sem corte fica
separada, porque escolher seria inventar de qual tribunal é o precedente.

## Consulta longa dentro de uma request

Uma consulta leva minutos e custa dinheiro; nada disso cabe num request HTTP.
`ThreadPoolExecutor` de 2 workers no próprio processo do uvicorn — sem Celery e
sem Redis, porque o grafo é síncrono, a durabilidade que importa já está no
`rag_runs.db`, e o gargalo real é USD por consulta, não CPU.

O `app.stream(stream_mode=["tasks","updates"])` entrega nó a nó. Como
`Estado.custos` é `Annotated[list, operator.add]`, cada nó devolve o próprio
custo no delta — **modelo, tokens e US$ por nó saem de graça, sem instrumentar
nada**. O `result` da task é um `dict`; a primeira versão do leitor assumiu
lista de pares e falhava calada, fazendo todo nó aparecer a US$ 0,0000 ao vivo
com o total certo no fim — que é o jeito mais convincente de um número errado
passar despercebido. Há um assert para isso em `api/execucao.py`.

Os `print()` de `no_triar` e `no_redigir` ("triagem cortada no teto", "AVISO: a
triagem não devolveu nota nenhuma") sumiriam no console do servidor.
`contextlib.redirect_stdout` não serve: ele troca o `sys.stdout` do *processo*, e
com dois workers um capturaria os prints do outro. O conserto é um roteador
instalado uma vez que despacha por thread do SO — e o self-check roda duas
threads imprimindo ao mesmo tempo para provar que não se misturam.

Se o servidor cair no meio, o startup reconcilia: quem parou vira
`interrompido`, e retomar usa `stream(None, config)` — reenviar o input
reiniciaria o grafo do zero e **repagaria** o que já saiu. Por isso retomar é
botão, não automatismo.

## Confidencialidade sem migrar nada

As decisões são públicas; as consultas dos advogados não. O `feedback.db` é
escrito pela CLI também e não tem coluna de dono, então a propriedade vive numa
tabela aditiva em `output/web.db`: thread sem dono é de quem rodou pelo
terminal, e só o admin vê. Migração: nenhuma.

Sessão opaca no servidor, não JWT — revogação imediata e "derrubar as sessões
deste usuário agora" são requisitos reais aqui, e com JWT isso vira lista de
revogação, que é o banco de sessão de volta só que pior. O token vive só no
cookie; no banco fica o `sha256` dele.

## Design

Referência: publicação jurídica e jornal de formato grande. Papel quente em vez
de branco, um acento só (verde-garrafa dessaturado), serifa para o texto
jurídico, régua de 1px no lugar de sombra. `frontend/DESIGN.md` tem a lista do que é
proibido — gradiente, glassmorphism, `box-shadow`, balão de chat em pílula,
emoji, skeleton pulsante — e `npm run lint:css` faz valer a parte que dá para
automatizar, para o padrão da indústria não voltar sorrateiramente um componente
por vez.

Duas regras que não são estéticas:

- **Evidência antes de veredito.** A aba de Prognóstico vem depois da de
  Evidências, sempre. Quem lê o percentual primeiro ancora nele e lê o resto
  procurando confirmação — é a mesma razão de `cli.formatar` montar o markdown
  nessa ordem.
- **NÃO DECIDO é estado de primeira classe**, com a lista de motivos e uma faixa
  hachurada no eixo dos estimadores. Não é erro nem vazio: é o comportamento
  correto.

O teste final do design é imprimir `/consulta/:thread` em PDF pelo Chrome. Se
não ler como documento, falhou.

## Sem fonte de CDN

As consultas são confidenciais e não se vaza nem o referrer. A v1 usa pilha de
sistema (`Charter, Georgia` no corpo). Para trocar por Source Serif 4, os
`.woff2` vão em `frontend/public/fontes/` e a família entra na frente de
`--fonte-serif`; nada mais muda.

---

## Plugando novas fontes (Escavador, SAJ...)

Cada fonte é um módulo com `coletar(config, storage)` que grava via `src/storage.py`.
Crie `src/minha_fonte.py`, chame em `src/main.py` e adicione a chave em `config.json.fontes`.

## Testes rápidos

```bat
.venv\Scripts\python -m src.datajud --teste        REM 1 consulta real ao Datajud
.venv\Scripts\python src\portal_jurisprudencia.py  REM self-check do parser (sem rede)
.venv\Scripts\python src\merge.py                  REM self-check do merge (em memória)
```

Fase 2 (nenhum consome chave de API, exceto onde indicado):

```bat
.venv\Scripts\python -X utf8 -m src.rag.classificador   REM asserts do classificador
.venv\Scripts\python -X utf8 -m src.rag.llm             REM parser de JSON + modelos configurados
.venv\Scripts\python -X utf8 -m src.rag.grafo           REM topologia + o nó de prognóstico
.venv\Scripts\python -X utf8 -m src.rag.busca "prescrição intercorrente"
.venv\Scripts\python -X utf8 -m src.rag.indexar         REM reconstrói o índice (~3 min)
.venv\Scripts\python -X utf8 -m src.rag.avaliar --offline -n 300
.venv\Scripts\python -X utf8 -m src.rag.juiz             REM rubrica + desvio de fornecedor
.venv\Scripts\python -X utf8 -m src.rag.feedback         REM tabela, teto do ajuste, concordância
.venv\Scripts\python -X utf8 -m src.rag.bench            REM 400 acórdãos: o relatório não vaza o desfecho
```

Fase 3 (todos offline, custo zero):

```bat
.venv\Scripts\python -X utf8 -m src.rag.sinais           REM ficha de procedência + perfil do argumento
.venv\Scripts\python -X utf8 -m src.rag.rerank           REM 2011 estadual perde de 2025 vinculante
.venv\Scripts\python -X utf8 -m src.rag.floresta         REM teste temporal + assert de vazamento
.venv\Scripts\python -X utf8 -m src.rag.avaliar --offline -n 400 --comparar
```

Fase 4 (todos offline, custo zero):

```bat
.venv\Scripts\python -X utf8 -m src.rag.deriva           REM dia da semana, ano, carga, âncora
.venv\Scripts\python -X utf8 -m src.rag.calibrar         REM monotonia + limites da isotônica
.venv\Scripts\python -X utf8 -m src.rag.confianca        REM faixas de abstenção + intervalo
```

Fase 5 (offline):

```bat
.venv\Scripts\python -X utf8 -m src.rag.grafo            REM a tese NÃO vaza para o prognóstico
.venv\Scripts\python -X utf8 -m src.rag.cli              REM varredura de tendência + cabeçalho da tese
.venv\Scripts\python -X utf8 -m src.rag.feedback         REM histórico acha por número e conta reuso
```

Fase 6 (offline; `api.smoke` sobe a API inteira contra um `web.db` temporário):

```bat
verificar.bat                                            REM roda tudo o que está abaixo, de uma vez
.venv\Scripts\python -X utf8 -m src.rag.rede             REM âncoras canonizadas, arestas únicas e sem laço
.venv\Scripts\python -X utf8 -m src.rag.estatisticas     REM agregações fecham com o total
.venv\Scripts\python -X utf8 -m src.rag.conversa         REM contexto do chat sai do checkpoint, cortado
.venv\Scripts\python -X utf8 -m api.auth                 REM scrypt, expiração, revogação, rate limit
.venv\Scripts\python -X utf8 -m api.serial               REM estado → JSON, e os pesos fecham
.venv\Scripts\python -X utf8 -m api.execucao             REM eventos SSE + prints de dois workers não se misturam
.venv\Scripts\python -X utf8 -m api.smoke                REM auth, CSRF, isolamento entre usuários
```

**`src.rag.indexar` não é self-check** — é o construtor do índice. Ele apaga
`output/rag.db` e reconstrói em ~4,5 min. Interrompido no meio, deixa o índice
vazio; e depois de reconstruir, `floresta.pkl` e `calibrador.pkl` ficam com o
selo defasado (o aviso aparece em stderr). O conserto é rodar
`floresta --treinar` e `calibrar --ajustar` na sequência — ambos são semeados e
reproduzem os mesmos números.

## Aviso

Dados públicos ≠ servidores infinitos: mantenha os delays, respeite os Termos de Uso dos
portais e o rate limit do Datajud (~120 req/min). Processos em segredo de justiça não
aparecem nas fontes.
