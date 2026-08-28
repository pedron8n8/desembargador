# Segundo Cérebro

**Um sistema que aprendeu a decidir como um desembargador específico — e que mostra, documento por documento, por que chegou àquela conclusão.**

Você cola o caso novo. Em cerca de dois minutos o sistema devolve três coisas:

1. **O prognóstico** — a chance de aquele desembargador reformar ou manter a sentença.
2. **A prova** — quais decisões dele sustentam esse prognóstico, o peso exato de cada uma e um mapa visual ligando todas elas.
3. **A minuta** — a peça já redigida no estilo dele, ancorada nesses mesmos precedentes.

E uma quarta, que é a mais incomum: **quando os dados não sustentam uma resposta, ele diz que não sabe.** Entrega o dossiê completo de evidências e se recusa a dar o veredito. É a diferença entre uma ferramenta e um chute com aparência de estatística.

---

# 1. De onde vêm as informações

## Coleta de documentos (*scraping*)

O sistema varre as bases públicas oficiais e monta um acervo completo de tudo o que aquele desembargador já julgou. Hoje ele cruza duas fontes:

| Fonte                                       | O que ela traz                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Portal de Jurisprudência do TJSC** | a ementa, o inteiro teor, o arquivo do acórdão, o relator, a câmara, a classe do processo e a data do julgamento  |
| **API Pública do Datajud (CNJ)**     | os metadados oficiais do processo e**todos os movimentos** — inclusive o que aconteceu *depois* da decisão |

As duas conversam pelo **número único do processo**. Nada é jogado fora: se um registro existe em apenas uma das fontes, ele entra do mesmo jeito, marcado com a origem. E o sistema guarda, **campo por campo**, de qual fonte cada informação veio. Se amanhã alguém perguntar "de onde saiu essa data?", a resposta está gravada.

**Números reais do primeiro acervo** (Des. Rubens Schulz, TJSC):

- **20.363 decisões** distintas, de 1990 até hoje
- **994 mil movimentos processuais** vindos do Datajud
- **281 MB** de inteiro teor — o texto integral, não só o resumo

A coleta é retomável: pode ser interrompida e continua exatamente de onde parou. Rodar de novo não duplica nada e não apaga o que já foi baixado — só busca o que falta e atualiza o que mudou.

## Um cérebro por magistrado

Cada desembargador é um **cérebro separado**: acervo próprio, modelos próprios, janelas de tempo próprias. Não existe uma "média do tribunal" — existe *ele*.

Hoje o sistema tem três cérebros mapeados: **Rubens Schulz** (pronto e em produção), **André Luiz Dacol** e **João Henrique Blasi**. Um cérebro só fica disponível para os usuários depois que o acervo dele foi coletado e indexado, justamente para nunca acontecer de alguém consultar e receber zero precedentes.

E há uma tela que só faz sentido porque os cérebros são independentes: **a mesma peça lida por dois desembargadores, lado a lado.** Ela não serve para dizer qual dos dois "acerta mais" — serve para mostrar **onde eles divergem**: precedentes diferentes, súmulas diferentes e, às vezes, desfecho diferente. Para quem escolhe estratégia recursal, isso é informação de valor direto.

---

# 2. Como o sistema pensa

O caminho de uma consulta é uma esteira de etapas. Cada uma tem uma função clara, e a tela mostra **ao vivo** qual delas está rodando, com qual modelo e quantos centavos já custou.

```
caso novo → entender o caso → buscar precedentes → triar (ler e notar)
          → ainda é pouco? volta e busca mais
          → prognóstico → redigir a minuta → revisar → dar nota → pronto
```

Duas coisas nesse desenho valem destaque, porque são elas que separam este sistema de um chatbot jurídico:

- **Ele volta atrás.** Se a triagem aprovar menos de três precedentes bons, a busca é refeita com o leque aberto — o dobro de candidatos, sem filtros. O sistema insiste antes de responder mal.
- **Ele se autocorrige.** Se o revisor reprova a minuta, ela volta para o redator com a lista de problemas. Não é uma passada única: é rascunho, crítica, correção.

## A busca: BM25

O **BM25** é o algoritmo que mecanismos de busca usam para medir o quanto um documento tem a ver com o que você procurou — pesando as palavras-chave pela raridade e pela frequência. É a peça que transforma 20 mil decisões numa lista de 40 candidatas em milissegundos.

Ele funciona muito bem aqui por um motivo específico: o vocabulário jurídico é fixo e distintivo. "Suscitação de dúvida", "prescrição intercorrente", "denunciação da lide" — quem escreve isso está falando de uma coisa só. A ementa pesa **três vezes** mais que o dispositivo na busca, porque o dispositivo ("dou provimento", "nego provimento") é quase igual nas 20 mil decisões e não distingue matéria nenhuma.

## A triagem: uma IA lendo cada candidato

Achar 40 candidatos parecidos no texto não é achar 8 precedentes *análogos*. Então uma IA lê os 40, um por um, e devolve para cada um:

- uma **nota de analogia** (o quanto o caso realmente se parece);
- **por que** deu essa nota;
- e **de que lado** aquele precedente joga: a favor, contra ou neutro.

Só o que é análogo *e* a favor chega ao redator. Essa etapa é o filtro que nenhum algoritmo de palavra-chave consegue fazer.

## O reordenamento (*ReRanking*): parecido não é o mesmo que valioso

O BM25 só vê texto. Para ele, um acórdão de 2011 já superado e um de 2025 ancorado em tema repetitivo do STJ **empatam**, se as palavras baterem igual. Qualquer advogado sabe que não empatam.

Então, antes de mandar os candidatos para a triagem, o sistema reordena a lista aplicando multiplicadores sobre a nota de similaridade. Nada aqui **inventa** relevância — tudo modula a relevância que já foi medida:

```
pontos = similaridade × recência × ancoragem × unanimidade × efeito posterior × seu feedback
```

E, na hora de calcular o peso final de cada precedente na conclusão, entram mais dois fatores: **a confiança** e **a nota de analogia** que a IA de triagem deu.

O ganho é pequeno e consistente. E o relatório imprime a conta de cada precedente — literalmente assim: *"idade 0,89 · âncora vinculante 1,35 → 1,32×"*.

---

# 3. Os pesos — o que faz um precedente valer mais

Estes são os cinco fatores reais que o sistema usa. Não são opiniões do modelo: cada um sai de um campo verificável no acervo.

## Peso 1 — Tempo (recência)

Quanto mais recente a decisão, mais ela vale. O decaimento é de **meia-vida de seis anos**: um acórdão de seis anos atrás pesa metade de um de hoje; de doze anos atrás, um quarto.

Isso não é preferência estética — é medição. O sistema auditou o acervo e descobriu que a taxa de reforma **varia de 28,0% a 38,9% de um ano para o outro**. Não é humor do desembargador: é jurisprudência que consolida e lei que muda. Um acórdão de 2011 descreve um tribunal que já não existe.

## Peso 2 — Ancoragem (o precedente vale para o país ou só para o estado?)

O sistema classifica cada decisão pela força da autoridade que ela cita:

| Tipo                 | O que é                                                                | No acervo       |
| -------------------- | ----------------------------------------------------------------------- | --------------- |
| **Vinculante** | tema repetitivo, IRDR, repercussão geral, súmula vinculante — obriga | **14,5%** |
| **Persuasiva** | súmula comum, precedente de REsp — convence, não obriga              | **50,8%** |
| **Estadual**   | fundamento só do próprio tribunal                                     | **34,7%** |

Uma decisão ancorada em autoridade vinculante ganha **+35%** de peso. É o maior multiplicador do sistema, e com razão: é o argumento mais difícil de o adversário derrubar.

## Peso 3 — Unanimidade

Decisão que **não** foi unânime perde **15%** de peso. Se um desembargador da própria câmara divergiu, aquele fundamento é terreno disputado — e citá-lo como pacífico é entregar o flanco. No acervo, **3,6% das decisões** têm divergência interna registrada.

## Peso 4 — Efeito posterior (o que a vida fez com aquela decisão)

Aqui entram os 994 mil movimentos do Datajud. O sistema olha o que aconteceu **depois** do julgamento: a decisão **transitou em julgado**? **Subiu para o STJ ou o STF**? Ficou **sobrestada**?

Decisão que transitou em julgado ganha **+10%** — ela sobreviveu. **55,9% do acervo** tem algum efeito posterior rastreado. É a diferença entre citar uma decisão e citar uma decisão que ninguém conseguiu derrubar.

## Peso 5 — O seu feedback

Você marca um precedente como **útil** ou **inútil**, e ele sobe ou desce nas consultas seguintes. Com um limite deliberado: **no máximo ±30%**.

O limite é uma decisão de projeto, não uma limitação técnica. A busca foi calibrada em 400 casos cegos; deixar meia dúzia de cliques desmanchar essa calibração seria trocar o que foi *medido* pelo que foi *sentido*. Precedente reprovado perde posição — não desaparece.

---

# 4. Os dois estimadores — e por que dois

O prognóstico não sai de um modelo só. Saem de dois, que erram em direções opostas.

**O primeiro é uma contagem ponderada** dos precedentes recuperados: entre as decisões dele mais parecidas com o seu caso, quantas reformaram? Ponderada pelos pesos acima. Esse número é **auditável**: dá para apontar exatamente quais oito decisões o produziram. **Ele não usa IA de propósito** — é aritmética sobre dados verificados.

**O segundo é uma Random Forest** (Floresta Aleatória): um método clássico de aprendizado de máquina que treina centenas de "árvores de decisão" independentes sobre o histórico e faz todas votarem. Aqui são 400 árvores. Ela lê o texto do caso, não a busca.

Sozinha, a floresta é ruim — e é por isso que ela é indispensável:

|                          | acerta quando aponta reforma | das reformas reais, quantas encontra |
| ------------------------ | ---------------------------: | -----------------------------------: |
| Contagem ponderada       |                        72,4% |                                48,5% |
| Random Forest            |                        39,3% |                      **94,6%** |
| **As duas juntas** |              **71,2%** |                      **68,5%** |

A floresta grita "reforma" muitas vezes à toa, mas quase não deixa reforma passar. A contagem é o inverso: quando aponta, acerta — mas deixa metade escapar. Juntas, o desempenho geral sobe de 58,1% para 69,8%.

**E quando os dois discordam, o sistema não esconde.** Os dois números aparecem lado a lado, e o redator recebe ordem expressa de **enfrentar os dois lados** — não de escolher um em silêncio.

---

# 5. A prova real — como sabemos que funciona

Esta é a parte que separa promessa de produto.

## O teste cego

O sistema sorteia **400 decisões que já foram julgadas**, **esconde cada uma do acervo** e entrega a ele apenas a parte que descreve o caso — filtrando fora qualquer trecho que revele o desfecho. Depois compara o que ele previu com o que o desembargador de fato decidiu.

Custo do teste: **zero**. Não passa por IA nenhuma. É a espinha do sistema medida sozinha.

| O que medimos                               |       Resultado |
| ------------------------------------------- | --------------: |
| Acerto do rótulo                           |           74,5% |
| Chutar sempre "mantém" acertaria           |           67,5% |
| **Quando ele prevê reforma, acerta** | **71,2%** |
| Taxa real de reforma no acervo              |           32,5% |
| **Vantagem sobre o chute**            | **2,2×** |

**Como ler isso honestamente:** o acerto bruto é quase inútil. Como duas em cada três decisões são "mantém", quem chutasse sempre "mantém" acertaria 67,5% sem saber nada. **O produto é a previsão de reforma.** Quando o sistema diz *"esse aqui ele reforma"*, acerta 71% das vezes contra uma taxa base de 32%. Vale mais que o dobro do chute.

E o inverso **não** vale: um caso que o sistema não sinaliza não é um caso que ele manteria. Está escrito no relatório com essas palavras.

## O número que tivemos que jogar no lixo

A primeira versão da floresta marcou **93,9% de acerto**. Não existe previsão judicial com esse número.

O problema: a ementa termina concluindo — *"PLEITO CONHECIDO E ACOLHIDO"* — e era dessa frase que o modelo tirava a resposta. Ele estava **copiando o gabarito, não prevendo**. O filtro que protegia o teste passou a proteger também o treino, com uma verificação automática que roda **antes** de qualquer número aparecer na tela. O resultado real e menor é o que está publicado acima.

Isso vale como declaração de método: **todo número neste documento passou por uma trava contra vazamento de resposta.**

## O número agora significa o que diz

Um sistema pode ordenar bem e mentir na escala — dizer "30% de chance" em casos que reformam 10% das vezes. Isso foi medido em **1.092 decisões de 2025** e corrigido com uma técnica de calibração estatística, ajustada em 1.200 decisões de 2024 e validada nas 1.092 de 2025 que **não** entraram no ajuste.

| O sistema dizia | Reformavam de verdade | Depois da calibração |
| --------------- | --------------------: | ---------------------: |
| 0–20%          |                  4,1% |         **4,6%** |
| 20–40%         |                  9,9% |        **24,0%** |
| 40–60%         |                 40,3% |        **52,2%** |
| 60–80%         |                 75,2% |        **72,5%** |
| 80–100%        |                 97,7% |        **93,4%** |

O maior desvio caiu de **21,9 para 5,0 pontos percentuais**. Quando a tela diz 70%, agora é 70%.

Detalhe deliberado: o resultado é limitado à faixa de 1% a 99%. **"0% de chance" não é estimativa, é promessa** — e o sistema não faz promessas.

## Saber calar é o que leva a 96%

Com um filtro de confiança, o sistema **só responde quando tem margem para responder**:

| Regime                   |   Responde em |          Acerta |
| ------------------------ | ------------: | --------------: |
| Sempre responder         |          100% |           80,2% |
| Filtro moderado          |           64% |           89,5% |
| **Filtro padrão** | **38%** | **96,7%** |

O preço de chegar a 96,7% é **não responder em 62% das consultas**. Nesses casos o dossiê de evidências sai completo — só o veredito não sai, com a lista dos motivos. Na tela, o **NÃO DECIDO** tem lugar próprio, com faixa hachurada no gráfico. Não é erro nem tela vazia: é o comportamento correto.

## O humor do desembargador aparece nos dados?

A pergunta merecia medição, não suposição. Foi medida:

| Eixo                     | Variação                          | Leitura                                                                |
| ------------------------ | ----------------------------------- | ---------------------------------------------------------------------- |
| **Dia da semana**  | 1,99 pp                             | **Não existe efeito de segunda-feira.** Esta é a boa notícia. |
| **Ano a ano**      | ~11 pp                              | É aqui que está a variação real — e é jurídica, não emocional. |
| Carga de trabalho no dia | 1,00 pp                             | Era composição da pauta, não cansaço.                              |
| Tipo de âncora citada   | vinculante 38,6% vs. estadual 32,2% | Sinal jurídico legítimo — e o sistema usa.                          |

A conclusão de projeto: o inimigo não é o humor de curto prazo, é a **mudança de época**. É por isso que a recência pesa, e é por isso que o relatório avisa que duas décadas de histórico **não descrevem o tribunal de hoje**.

---

# 6. A redação — e quem vigia o redator

## O redator

A minuta é escrita por um **modelo de linguagem** (a tecnologia por trás do ChatGPT e afins), mas com uma diferença que muda tudo: ele **não escreve de memória**. Ele recebe o texto integral dos precedentes selecionados e é obrigado a ancorar cada argumento neles.

Uma regra explícita: **o prognóstico estatístico não entra no voto.** Nenhum acórdão real diz "a estatística indica reforma". Numa primeira medição, 7 de 32 minutas vazavam a estatística para dentro do texto. Depois da correção: **zero de 32.**

## O revisor

A minuta passa por um segundo modelo, **de propósito de outro fornecedor**, que a critica e devolve a lista de problemas. Crítica independente é o ponto: modelo da mesma família tende a concordar consigo mesmo.

## A trava de tendência

Existe ainda uma verificação final que **não depende de IA nenhuma**: uma varredura no texto pronto caçando afirmações que os dados não sustentam — do tipo *"os precedentes desta Corte são uníssonos"* quando a amostra foi filtrada para sustentar um lado. Os trechos suspeitos aparecem em destaque **antes** da minuta.

Ela existe porque falhou de verdade: numa consulta real o revisor apontou o problema, mas não sobrou ciclo para corrigir, e a frase saiu na peça final. A varredura por regra fixa não tem esse risco.

## "Onde esta tese é frágil"

Toda minuta fecha com uma seção obrigatória apontando, **do próprio material recuperado**, o que enfraquece a tese: precedente que não foi unânime, âncora que só vale no estado, fato que afasta a analogia.

É o oposto de uma ferramenta que só te dá razão. E é o que você quer ler antes de o adversário escrever.

## O juiz automático (*LLM as a Judge*)

Um terceiro modelo dá nota de **0 a 5** para cada minuta, em dois modos:

- **Com gabarito** — em casos já julgados, ele compara a minuta com a decisão verdadeira. É a medição que vale.
- **Sem gabarito** — em caso novo, avalia só coerência interna e fidelidade às fontes. **Não** diz se a decisão está juridicamente certa, e o relatório declara isso.

Duas travas: o juiz **nunca é do mesmo fornecedor do redator** que ele está julgando (modelo julgando a si mesmo se dá nota alta), e o modo com gabarito transforma a nota em **concordância com um fato**, não em preferência estética.

**Você também dá nota.** E a sua nota vale mais que a do juiz automático: guardadas lado a lado, elas respondem à pergunta que decide o sistema inteiro — *o juiz automático concorda com o advogado?* Se sim, dá para trocar de modelo medindo, sem ler minuta nenhuma. Se não, o juiz não serve como instrumento.

## Escolher o modelo por medição, não por marketing

O sistema tem uma bancada de testes que roda vários modelos nos mesmos casos já julgados e compara com a decisão real. O que ela descobriu:

- Na primeira rodada, a diferença entre o melhor e o pior modelo era **estatisticamente indistinguível de sorte**. A regra escrita antes do teste mandava ignorar o ranking — e ignoramos.
- Corrigidos os defeitos que o teste expôs, **8 de 8 modelos melhoraram**, e a média subiu de 2,39 para 2,96 de 5. *Essa* diferença é significativa.
- O modelo escolhido custa **3,2× menos** que o mais caro e teve nota igual ou melhor.
- E o achado que vale mais que o ranking: **nenhum modelo reproduz as decisões dele bem** — nem o mais caro. O gargalo não é o modelo.

O critério que decide não é a nota média. É **o dispositivo bateu com o real?** Uma minuta belamente escrita com o dispositivo trocado é pior que inútil.

---

# 7. A comprovação — o mapa da decisão

## Grafos

Um **grafo** é uma estrutura formada por pontos (os **nós**) ligados por linhas (as **arestas**). É o desenho que qualquer pessoa reconhece: bolinhas ligadas por fios.

Além da resposta, o sistema desenha o mapa dos documentos que usou para chegar nela — com o peso de cada um. Você vê o raciocínio, não só a conclusão. E pode clicar em qualquer nó para ler a decisão inteira.

## A escolha que faz o mapa ser legível

A forma óbvia seria ligar decisão a decisão quando as duas citam a mesma súmula. Foi testado: 40 candidatos geraram **466 linhas**, porque 20 decisões que citam a mesma súmula formam um emaranhado de 190 ligações. Isso não é visualização, é novelo — e esconde justamente o que interessa.

A solução: **a súmula virou nó.** A mesma informação passou a custar 20 linhas em vez de 190, e a leitura virou uma frase jurídica direta: *"estas 20 decisões se apoiam na Súmula 150."*

Houve um detalhe invisível e decisivo: o acervo tinha **1.941 rótulos diferentes** para um número muito menor de súmulas reais, porque o mesmo verbete aparece como `Súmula 54 do STJ`, `SÚMULA 54 DO STJ`, `Súmula n. 54` e `Súmula 54`. Sem unificar isso, o mapa saía **vazio sem dar erro** — o pior modo de um sistema falhar.

## O painel de pesos

A cascata inteira, aberta na tela:

```
similaridade × recência × ancoragem × unanimidade × efeito × seu feedback = pontos
pontos × confiança × analogia = peso final
```

E a fração de cada precedente no total. Se um único acórdão está sustentando 40% da conclusão, você vê isso — e decide se concorda.

## O que o sistema se recusa a afirmar

- **"Em quais estados esse argumento funciona"** não é respondível, e o relatório diz isso com todas as letras. O acervo é 100% TJSC. Dá para afirmar que um tema repetitivo do STJ vincula o país; não dá para dizer o que o TJSP faz com ele. Estimar seria inventar autoridade num campo que parece autoritativo.
- **Empate é respondido como empate.** Quando os precedentes se dividem meio a meio, não existe "lado majoritário" — afirmar que existe seria inventar uma tendência que os dados não mostram.

---

# 8. Como você usa

## As quatro perguntas do começo

```
Que análise você quer deste caso?
  1) neutra     — o que o acervo diz, sem lado
  2) reformar   — puxa também os precedentes que deram provimento
  3) manter     — o mesmo, do lado que negou provimento
  4) histórico  — processos e consultas que você já usou
```

## Modo tese: a evidência na cara

Quando você pede um lado, quem separa o que serve não é um filtro de banco de dados — é a IA que **lê o mérito** de cada candidato. Isso importa porque um rótulo processual engana: um acórdão marcado como *"provido"* em que quem recorreu foi a **seguradora** é material **contra** um segurado. O sistema aprendeu isso errando: pediram "reformar" e a minuta saiu mandando manter, sendo fiel a oito precedentes que argumentavam o contrário do pedido.

O resultado dessa correção é a informação mais franca que o sistema produz. No mesmo caso real:

| Você pediu        | Precedentes aproveitados                | Dispositivo da minuta        |
| ------------------ | --------------------------------------- | ---------------------------- |
| neutra             | 8 de 40                                 | condicional (dois cenários) |
| **reformar** | **3 de 67** — 63 decidiam contra | DOU-LHE PROVIMENTO           |
| **manter**   | **33 de 34** — nenhum contra     | NEGO-LHE PROVIMENTO          |

Leia os números do meio. Para sustentar "reformar" neste caso, o sistema teve de descartar **63 precedentes análogos que decidem contra**, e precisou de duas rodadas de busca para achar 3 que ajudassem. Para "manter", 33 de 34 serviam de primeira.

**Isso é a força do seu caso, escancarada, antes de você entrar com a peça.**

E há uma consequência ética embutida: **no modo tese não sai percentual nenhum.** Contar resultado numa amostra escolhida para sustentar um lado mede a sua escolha, não o tribunal. O sistema tem uma verificação automática que **falha de propósito** se qualquer número de prognóstico escapar para uma consulta com tese.

## Os pontos em comum

Entre os precedentes que sobraram, o sistema conta o que se repete — sem IA, direto no acervo:

```
- Âncoras citadas por mais de um: Súmula n. 5 (7 vezes)
- Câmaras: Segunda Câmara de Direito Civil (8)
- 8 de 8 unânimes, 7 transitaram em julgado, anos 2019–2019
```

E quando **nenhuma** âncora aparece em mais de um, ele diz o contrário com clareza: são decisões que chegaram ao mesmo lugar por caminhos diferentes, e **não há tese única para citar**.

## O que você já usou

O sistema guarda o histórico e responde "já usei esse processo?". Conta reuso (`0302503-58.2017.8.24.0008 — 4 vezes`) e mostra o veredito que você deu a cada precedente. Busca por número de processo ou por tema.

## A conversa

Terminada a consulta, abre-se uma janela para você **conversar com o sistema sobre aquele caso** — com todo o material que ele usou ainda na mão. Perguntar por que um precedente pesou o que pesou, pedir para explicar um trecho, testar uma objeção.

Custo de uma pergunta: cerca de **meio centavo de dólar**, porque ele não refaz a análise — consulta o que já foi feito.

---

# 9. O que você recebe, na prática

O relatório sai **nesta ordem**, e a ordem não é estética:

```
1. EVIDÊNCIAS        os precedentes usados, com a ficha de cada um
2. O QUE CORTA       contra-argumentação: o que decidiu para o outro lado
3. PROCEDÊNCIA       idade, ancoragem, quantas vezes o argumento foi usado, efeito posterior
4. PROGNÓSTICO       o percentual calibrado — ou NÃO DECIDO, com os motivos
5. MINUTA            a peça redigida, fechando com "onde esta tese é frágil"
```

**O número vem por último de propósito.** Quem lê o percentual primeiro ancora nele e lê todo o resto procurando confirmação. Colocado no fim, ele é lido como conclusão — não como premissa. A interface obedece à mesma regra: a aba Prognóstico vem **depois** da aba Evidências, sempre.

## As telas

| Tela                          | O que ela responde                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Pipeline ao vivo**    | qual etapa está rodando, com qual modelo, quantos centavos — passo a passo                                                |
| **Painel de pesos**     | a cascata completa e a fração de cada precedente na conclusão                                                            |
| **Rede de precedentes** | quais decisões se apoiam na mesma súmula ou tema repetitivo                                                               |
| **Estatísticas**       | variação por época, taxa por classe e câmara, curva de calibração e o quanto o sistema se absteve**no seu uso** |
| **Acervo**              | as 20.363 decisões, com a busca explicando a própria ordem                                                                |
| **Comparação**        | a mesma peça lida por dois desembargadores diferentes                                                                      |
| **Conversa**            | perguntar sobre uma consulta já feita                                                                                      |

E há um livro-caixa: **cada centavo gasto, por etapa e por consulta**, vindo direto do fornecedor — não estimado.

---

# 10. Confidencialidade

As decisões são públicas. **As suas consultas não são.**

- Cada usuário vê **só as suas** consultas. O isolamento entre contas é testado automaticamente a cada versão.
- Sessão revogável no servidor: "derrubar os acessos deste usuário agora" é um botão que funciona de imediato.
- **Nenhum recurso vem de fora.** Nem fontes de letra são carregadas de servidores de terceiros — porque isso vazaria para eles, no mínimo, que uma consulta está sendo feita e de onde.
- Processos em segredo de justiça **não** entram no acervo. Quando o portal exige login, o registro fica marcado e o conteúdo não é coletado.

---

# 11. Em uma frase

> Um segundo cérebro que leu tudo o que aquele desembargador já julgou, que prevê como ele decidiria com **2,2× mais acerto** que o chute, que **acerta 96,7% quando decide responder** — porque aprendeu a calar quando não sabe —, que redige a peça no estilo dele e que **mostra o mapa completo de como chegou lá**, documento por documento, peso por peso, por menos de **25 centavos de dólar** por consulta.

## E o que ele não é

Registrar isto é parte do produto:

- **Não substitui o advogado.** Entrega evidência organizada e um rascunho ancorado. A decisão de estratégia e a peça final são humanas.
- **Não prevê o futuro.** Prevê o padrão histórico de um magistrado específico, num acervo específico, num recorte de tempo específico.
- **Deixa reformas passar.** Um caso que ele não sinaliza não é um caso que o desembargador manteria.
- **A minuta é a parte que pode errar** — e é por isso que ela é a única coisa no sistema que passa por um revisor independente, um juiz automático e a sua nota.
