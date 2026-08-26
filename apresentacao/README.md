# apresentacao/

A apresentação comercial do Segundo Cérebro — a página que se abre na frente de
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
  apresentacao.json   o caso, o acervo, o prognóstico, o rastro de execução, o juiz
  grafo.json          nós e arestas do cérebro (etapas + os 40 lidos + âncoras)
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
| o grafo | `frontend/src/comp/GrafoCerebro.tsx` |
| o confronto | `frontend/src/comp/Confronto.tsx` |
| o visual | `frontend/src/estilo/apresentacao.css` (mundo próprio, sob `.apr`) |

O desvio da rota está em `frontend/src/App.tsx`, **antes** do teste de sessão —
sem isso quem não tem conta seria mandado para `/entrar` e nunca veria a tela de
senha.
