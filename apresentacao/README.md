# apresentacao/

A apresentação comercial do **DrSec** — a página que se abre na frente de
alguém. Fica em **`/apresentacao`**, protegida por senha própria.

É a única rota do sistema que **não exige conta**: o link vai para quem está sendo
apresentado ao produto, e essa pessoa não tem cadastro.

## Como abrir

```
http://localhost:5173/apresentacao        (dev)
https://<dominio>/apresentacao            (produção)
```

A senha está em `.env`, na variável `APRESENTACAO_SENHA`. Sem ela a rota fica
desabilitada e a tela diz isso — não existe senha padrão de propósito.

```bash
# trocar a senha
#   edite .env e reinicie o servidor
# derrubar todos os acessos agora (não afeta ninguém logado no sistema)
sqlite3 output/web.db "DELETE FROM sessao_apresentacao"
```

## O que tem dentro

```
fontes/        os documentos, na íntegra, como estavam quando a página foi montada
  prova.md         o dossiê de comprovação (auditoria dos números)
  info.md          a descrição do sistema
  config_rag.json  os pesos e cortes em vigor
  casos/           as peças entregues ao sistema nos testes cegos
  acordaos/        o inteiro teor real de cada processo usado
  consultas/       a saída bruta de cada consulta (demo-* e cego-* e sp-*)
  candidatos-demo-arresto.json
                   os 40 candidatos que a triagem LEU, com nota, motivo e conta —
                   inclusive os 32 reprovados, que o relatório .md não imprime

dados/         o JSON que a página consome — GERADO, não editado à mão
  apresentacao.json   o caso, o acervo, o prognóstico, o rastro de execução, o juiz,
                      a cascata de pesos e a base legal da minuta
  grafo.json          nós e arestas do cérebro (etapas + os 40 lidos + âncoras + leis)
  confronto.json      decisão real × decisão gerada, alinhadas item a item

montar.py      gera dados/ a partir de fontes/ e dos bancos
```

**Nenhum número da tela é digitado à mão.** Tudo o que aparece sai de
`dados/`, e `dados/` sai do relatório real de uma consulta ou do acervo. Se algo
mudar no sistema:

```bash
.venv\Scripts\python -m apresentacao.montar
```

O `montar.py` tem travas: ele se recusa a gerar se a consulta da demo não for uma
em que o sistema **decide**, se o prognóstico não bater com o resultado real do
processo, ou se o congelado dos candidatos descrever uma execução diferente da que
o relatório descreve.

### Os candidatos reprovados

O relatório `.md` só imprime os **8 aprovados**. Os **32 que foram lidos e não
passaram** — com a nota de analogia, o motivo que o modelo escreveu e a conta de
rerank — só existem no checkpoint do LangGraph (`output/rag_runs.db`), que tem
34 MB, está no `.gitignore` e guarda formato interno da biblioteca. Por isso eles
são **congelados** em `fontes/`:

```bash
.venv\Scripts\python -m apresentacao.montar --congelar
```

Roda uma vez, ou quando a consulta da demo for refeita. A ficha e a conta saem das
mesmas funções que o relatório usa (`sinais.resumir_ficha`, `rerank.explicar`), e a
rede entre eles sai de `src/rag/rede.py` — o mesmo módulo que serve a aba Rede do
produto. Nada disso é reimplementado aqui.

Uma nota que a tela precisa dizer certo: **quem reprova é a nota de analogia, não a
conta de rerank.** O rerank decidiu quais 40 dos 80 do BM25 chegaram a ser lidos, e
desempata dentro da mesma nota. Chamar a conta de "o que descartou" seria a tela
mentindo.

### A cascata do prognóstico, e por que ela é congelada

O congelado carrega também `pesos`, que é o retorno de **`api/serial.pesos`** — a
mesma função que serve a aba Pesos de `/consulta/:thread`. Por precedente: bm25,
fatores do rerank, pontos, peso de confiança, nota normalizada, peso final e
fração do total; mais a agregação (k-NN, floresta, conjunto, calibrado, intervalo)
e o dossiê do portão de confiança.

A seção **09 · DE ONDE VEM O NÚMERO** reencena esses números passo a passo. Ela não recalcula
nada: refazer a aritmética em TypeScript para poder animá-la seria manter duas
contas do mesmo prognóstico, e no dia em que divergissem a tela mentiria sem
avisar. O acumulador que sobe na última coluna é soma parcial dos pesos
congelados, e fecha exatamente nos 89,1% que o relatório imprimiu — se um dia não
fechar, é porque a tela deixou de ser a conta do pipeline.

### As duas seções de movimento

**05 · O CÉREBRO DO RELATOR** é o mapa parado, com força d3, para ser explorado com
o mouse. **06 · O CÉREBRO ACONTECENDO** é o mesmo cérebro em execução: layout à mão (a ordem é
a informação, e uma simulação que a embaralha a cada carregamento tiraria
justamente o que se quer mostrar), um nó de cada vez, na ordem de execução, com os
40 lidos acendendo um por um até sobrarem 8.

Nas duas, os nós **já estão na tela desde o primeiro quadro**, apagados. O que a
animação mostra é a ordem, não a existência: se as folhas fossem aparecendo do
nada, o tamanho do funil 40 → 8 só seria legível no fim, que é justamente quando
ninguém está mais contando.

### O as-is e o to-be

Quatro desenhos da página não saem de `dados/`: **02 · O GABINETE, HOJE**, **03 ·
O EPROC, HOJE**, **07 · ONDE O DRSEC ENTRA** e **12 · DENTRO DO EPROC**. Eles são
editoriais e vivem como arrays de `NoDiag` no topo de `Apresentacao.tsx`.

Por isso **não carregam número nenhum**: o campo `valor` deles é sempre uma
palavra ("de memória", "o mérito", "sem rastro"), nunca uma estatística de
gabinete. Numa página cujo contrato é não ter número digitado à mão, inventar um
tempo médio de tramitação aqui derrubaria, por contágio, os números que foram
medidos de verdade.

`GABINETE` (02) e `COM_DRSEC` (07) são **um par**: mesmo primeiro nó, mesmo
último nó, mesma quantidade de níveis. A apresentação não tem tabela comparativa
de propósito — a comparação é a semelhança entre os dois desenhos, e o leitor a
faz sozinho. Mexer em um sem mexer no outro desfaz o argumento sem quebrar nada
nem dar erro em lugar nenhum.

### As leis

`sinais.leis()` extrai o dispositivo legal do inteiro teor, e `indexar` o guarda em
`decisao.leis_json` — 90% do acervo tem pelo menos um. Isso serve a três lugares:
a lista dos artigos que os precedentes recuperados invocam entra no prompt do
redator (`grafo._bloco_procedencia`), a lei vira **nó próprio** no grafo (losango,
separado do quadrado da âncora — são autoridades diferentes) e a seção 08 mostra em
que dispositivos a minuta se apoiou, ao lado do que o acórdão real citou.

O checkpoint da demo é **anterior** à coluna `leis_json`, então `--congelar` busca
as leis no índice, por id. Não é recalcular a consulta: a extração é determinística
sobre o mesmo inteiro teor, e o id é o mesmo dos dois lados.

Uma coisa que o sistema **não** tem: o texto de lei nenhuma. Ele sabe em que
artigos as decisões reais desta câmara se apoiam nesta matéria, e é só isso que
afirma — a tela diz essa frase com todas as letras.

## A apresentação não fala em dinheiro

Nenhum valor monetário aparece na tela — e o corte é na **fonte**, não no layout.
`montar.py` varre recursivamente qualquer chave de valor (`usd`, `total_usd`, …)
antes de gravar, e depois confere o JSON inteiro; se um preço escapar, a montagem
**falha** em vez de deixá-lo passar.

O motivo é concreto: `dados/*.json` é servido por `/api/apresentacao/dados`, então
um número que sobrasse ali apareceria no DevTools de quem está assistindo à
demonstração — exatamente a pessoa de quem não se quer mostrar o custo de
produção. Esconder só no React não esconderia nada.

O livro-caixa continua inteiro em `fontes/consultas/` e no `prova.md`. Ele não
sumiu; só não sai por esta rota.

## O caso da demonstração

`5024128-82.2025.8.24.0000` — agravo de instrumento, execução de título
extrajudicial, arresto online via Sisbajud. Julgado de verdade em 24/04/2025 pela
6ª Câmara de Direito Comercial. Resultado real: **provido**.

O que o sistema recebeu foi o **relatório do próprio acórdão** — a síntese que o
tribunal faz da decisão recorrida e das razões recursais — cortado **antes do
voto**, com a decisão **escondida do índice** (`--excluir 12522`). Sem isso ele
acharia a resposta pronta e o teste viraria cópia.

Ele previu **98% de chance de reforma** e escreveu um dispositivo que bate com o
real. Duas coisas divergem, e as duas estão na tela: uma citação de REsp que o
redator inventou (o juiz automático do próprio sistema pegou) e a ausência de
precedentes de outros relatores (o acervo é de um só).

## O caso foi escolhido — e a tela diz isso

De 1.369 processos de 2025 elegíveis, um pré-filtro que não usa IA apontou 245 em que
o sistema provavelmente cravaria um prognóstico. Foram consultados 7; em 2 ele
efetivamente decidiu. **Não é representativo:** na medição de 400 casos ele
responde em 37,8% das vezes. Esse número está impresso na apresentação, porque
uma demonstração que o escondesse seria uma vitrine montada.

## Onde mora o código

| | |
| --- | --- |
| rota e senha | `api/apresentacao.py` (self-check: `python -m api.apresentacao`) |
| tabela de sessão | `api/esquema.py` → `sessao_apresentacao` |
| a página | `frontend/src/paginas/Apresentacao.tsx` |
| o grafo (seção 05) | `frontend/src/comp/GrafoCerebro.tsx` |
| a árvore rodando (06) | `frontend/src/comp/ArvoreAoVivo.tsx` |
| a conta do prognóstico (09) | `frontend/src/comp/ContaAoVivo.tsx` |
| o confronto | `frontend/src/comp/Confronto.tsx` |
| o visual | `frontend/src/estilo/apresentacao.css` (mundo próprio, sob `.apr`) |

O desvio da rota está em `frontend/src/App.tsx`, **antes** do teste de sessão —
sem isso quem não tem conta seria mandado para `/entrar` e nunca veria a tela de
senha.
