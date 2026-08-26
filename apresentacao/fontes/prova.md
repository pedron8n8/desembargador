# Dossiê de comprovação

**Uma consulta real do sistema, refeita à mão, número por número.**

Este documento não descreve o sistema — isso está em `info.md`. Ele faz uma coisa só: pega **uma consulta que já rodou**, mostra tudo o que ela produziu, e depois **refaz a conta por fora**, direto do banco de dados, para provar que o resultado não é opinião do modelo nem número inventado na tela.

Três perguntas, três respostas verificáveis:

| A pergunta | A resposta | Onde está |
| --- | --- | --- |
| O sistema faz o que diz que faz? | **8 de 8** contas de peso refeitas batem com o relatório | §4 |
| O resultado é reproduzível? | a cadeia inteira, do peso ao veredito, foi recalculada e deu **igual** | §5 |
| Ele acerta o mundo real? | **71,2%** de acerto quando prevê reforma, contra **32,5%** de chute — **2,19×** | §7 |
| Os números publicados batem? | **12 de 12** reproduzidos hoje, sem arredondamento a favor | §7 |
| E em processos reais já julgados? | **4 de 4**: absteve-se em todos; a minuta trazia o desfecho real nos 4 | §8 |

Tudo aqui é conferível: os comandos que geram cada número estão em §9, e qualquer pessoa com o banco na mão chega ao mesmo lugar.

---

# 1. A consulta que foi feita

**Arquivo de entrada:** `exemplos/caso.txt`
**Cérebro consultado:** Desembargador Rubens Schulz (TJSC) — 20.363 decisões
**Quando:** 06/08/2026, 08:55
**Saída original, íntegra:** `output/consultas/v2-neutra.md`

O caso: apelação cível em ação de cobrança de seguro de vida em grupo. Trabalhador rural aposentado por invalidez pelo INSS; a seguradora nega a indenização alegando que a apólice cobre apenas **invalidez funcional permanente total por doença (IFPD)** — que exige perda da existência independente — e não a mera incapacidade laborativa. Sentença de improcedência. O autor apela alegando cerceamento de defesa (perícia indeferida), abusividade da cláusula limitativa e aplicação da Súmula 610 do STJ por analogia.

É um caso construído para teste, com desfecho desconhecido. Isso é proposital: aqui se testa o **mecanismo**. O acerto contra o mundo real é medido separadamente, em §7, com 400 decisões já julgadas.

---

# 2. Etapa 1 — O que o sistema entendeu do caso

Primeira coisa que o sistema fez, antes de buscar qualquer coisa: leu a peça e devolveu a leitura em campos fechados.

```
Classe:   Apelação Cível
Matéria:  Seguro de vida em grupo e invalidez
Tese:     A sentença deve ser anulada por cerceamento de defesa ou reformada
          para reconhecer a cobertura securitária, diante da abusividade da
          cláusula que restringe a invalidez à perda da existência independente.
Pedidos:  Anulação da sentença para realização de perícia médica
          Condenação da seguradora ao pagamento da indenização securitária
          Reconhecimento da abusividade da cláusula limitativa de cobertura
          Pagamento proporcional ao grau de invalidez apurado
```

**Por que isso importa para a prova:** os quatro pedidos aparecem, um a um, enfrentados na minuta de §6. Nada foi esquecido no caminho, e dá para conferir lendo.

---

# 3. Etapa 2 — A busca, com a consulta literal

O sistema montou esta consulta de texto completo (FTS5) e a disparou contra as 20.363 decisões:

```sql
"cerceamento de defesa" OR "perícia médica judicial"
OR "seguro de vida em grupo" OR "invalidez funcional permanente"
OR "invalidez permanente por doença" OR "cláusula limitativa de cobertura"
OR "perda da existência independente" OR "interpretação mais favorável"
OR "aposentadoria por invalidez" OR "honorários recursais"
```

O BM25 devolveu **80** decisões; o rerank reordenou as 80 pela ficha de procedência e cortou em **40** (`src/rag/grafo.py:332-335`). É de propósito: a triagem passa a ver os 40 melhores de 80, e não os 40 primeiros do BM25 — quem paga o dobro é o SQLite, em milissegundos. Uma IA então leu os 40, um por um, e devolveu para cada um uma nota de analogia de 0 a 5, o motivo da nota e de que lado o precedente joga.

**8 passaram** (nota mínima 3). Os 8 tiraram **5/5** — não é uma amostra folgada, é o teto:

| Precedente | Analogia | Por que a IA deu essa nota |
| --- | :---: | --- |
| 0302503-58.2017.8.24.0008 | 5/5 | Trata de cobrança de seguro, IFPD e validade de cláusula limitativa |
| 0002830-89.2013.8.24.0049 | 5/5 | Envolve seguro de vida, IFPD, incapacidade laboral e INSS |
| 0011166-15.2013.8.24.0039 | 5/5 | Analisa seguro de vida, IFPD, dever de informação e INSS |
| 0308521-36.2015.8.24.0018 | 5/5 | Discute seguro de vida, cobertura IFPD e incapacidade laborativa |
| 0004462-43.2009.8.24.0033 | 5/5 | Trata de seguro de vida, IFPD e aposentadoria por invalidez do INSS |
| 0002592-72.2013.8.24.0016 | 5/5 | Discute IFPD, doença ocupacional, INSS e dever de informação |
| 0003737-03.2012.8.24.0016 | 5/5 | Envolve seguro de vida, doença e análise pericial de incapacidade |
| 0313797-96.2016.8.24.0023 | 5/5 | Discute IFPD, dever de informação e irrelevância do INSS |

Cada um traz o link direto para o acórdão no portal do TJSC. **Não há citação sem endereço.**

---

# 4. Etapa 3 — A conta de peso, refeita à mão

Aqui está o núcleo da prova. O relatório de 06/08 imprimiu, para cada precedente, a conta que o levou àquele peso. Exemplo, literal, como saiu na tela:

```
Ranking: idade 0.56 · âncora vinculante 1.35 · transitou em julgado 1.10 → 0.83x
```

A fórmula é fixa e está no código (`src/rag/rerank.py`), com os fatores no `config_rag.json`:

```
peso = recência × âncora × unanimidade × efeito posterior × seu feedback

recência   = 0,5 ^ (idade em anos ÷ 6), com piso de 0,50
âncora     = vinculante 1,35 | persuasiva 1,15 | estadual 1,00
unanimidade= não unânime 0,85
efeito     = transitou 1,10 | subiu sem trânsito 0,90 | sobrestado 0,80
feedback   = teto de ±30%
```

**A verificação:** peguei os 8 processos direto no banco (`output/rag.db`), li os campos brutos — ano, âncora, unanimidade, efeito do Datajud — e recalculei cada peso do zero, sem olhar o relatório. Resultado:

| Processo | Ano | Âncora | Unân. | Efeito | Conta refeita | Refeito | Impresso | |
| --- | :---: | --- | :---: | --- | --- | ---: | ---: | :---: |
| 0302503-58.2017.8.24.0008 | 2021 | vinculante | ? | transitou | 0,5612 × 1,35 × 1,10 | 0,83 | 0,83 | ✔ |
| 0002830-89.2013.8.24.0049 | 2019 | persuasiva | sim | transitou | 0,5000 × 1,15 × 1,10 | 0,63 | 0,63 | ✔ |
| 0011166-15.2013.8.24.0039 | 2019 | persuasiva | sim | transitou | 0,5000 × 1,15 × 1,10 | 0,63 | 0,63 | ✔ |
| 0308521-36.2015.8.24.0018 | 2021 | persuasiva | ? | transitou | 0,5612 × 1,15 × 1,10 | 0,71 | 0,71 | ✔ |
| 0004462-43.2009.8.24.0033 | 2016 | persuasiva | sim | — | 0,5000 × 1,15 | 0,57 | 0,57 | ✔ |
| 0002592-72.2013.8.24.0016 | 2018 | persuasiva | sim | — | 0,5000 × 1,15 | 0,57 | 0,57 | ✔ |
| 0003737-03.2012.8.24.0016 | 2016 | estadual | sim | — | 0,5000 | 0,50 | 0,50 | ✔ |
| 0313797-96.2016.8.24.0023 | 2021 | persuasiva | ? | transitou | 0,5612 × 1,15 × 1,10 | 0,71 | 0,71 | ✔ |

> **8 de 8 conferem.** Nenhum arredondamento fora do lugar, nenhum peso sem origem.

Repare no primeiro: 2021, cinco anos atrás → 0,5^(5/6) = **0,5612**. Ancorado no **Tema 1068/STJ**, que é vinculante → **1,35**. Transitou em julgado segundo o Datajud → **1,10**. Produto: **0,8334**, impresso como 0,83.

E repare no último da lista: 0003737-03.2012, ancorado **só no próprio tribunal**, sai com 0,50 — o menor peso da lista. **O sistema penaliza o precedente estadual mesmo quando ele concorda com a maioria.** Não é um viés a favor da conclusão: é uma regra aplicada antes de saber qual seria a conclusão.

---

# 5. Etapa 4 — O prognóstico, e por que ele não foi dado

Dois estimadores, como o sistema sempre faz:

| Estimador | P(reforma) | O que é |
| --- | ---: | --- |
| k-NN sobre os precedentes | **14,5%** | auditável: sai dos 8 precedentes de §4 |
| Random Forest | **53,9%** | opaco: 400 árvores treinadas em 7.545 decisões até 2023, não olha os precedentes |
| **conjunto** | **34,2%** | média ponderada |

**Refazendo a conta** (o peso do k-NN está fixado em 0,5 no `config_rag.json`):

```
conjunto  = 0,50 × 14,5%  +  0,50 × 53,9%  =  34,2%     ✔ igual ao relatório
calibrado = calibrador isotônico aplicado  =  26,5%     ✔ relatório imprimiu 26%
margem    = |0,265 − 0,50|                 =  0,24
corte     = 0,35                           →  0,24 < 0,35
```

**Veredito: NÃO DECIDO.** ✔ Igual ao relatório.

E o motivo saiu escrito na tela, não escondido em log:

> *a estimativa (26%) está perto demais do meio — nesta faixa o sistema acerta ~70%, contra 96,7% quando a margem é folgada*

Vale insistir no que aconteceu aqui, porque é o comportamento mais difícil de fingir: **o sistema tinha um número pronto — 26% — e se recusou a apresentá-lo como prognóstico.** Os dois estimadores discordavam em 39 pontos (14,5% contra 53,9%); o caso está na fronteira; a máquina disse isso em vez de escolher um lado em silêncio. As evidências saíram completas assim mesmo.

Um sistema que quisesse impressionar teria mostrado "26% de chance de reforma" e ninguém saberia que aquilo era um palpite.

---

# 6. Etapa 5 — A minuta

Escrita pelo redator (`deepseek/deepseek-v3.2`) sob instrução expressa de **não afirmar um desfecho como provável**, já que o prognóstico foi negado. O que ela produziu:

- **Preliminar de cerceamento de defesa** — enfrentada, ancorada em 0004462-43.2009 e 0003737-03.2012.
- **Caminho que conduz à improcedência** — sete precedentes citados nominalmente, com quatro fundamentos destacados (perda da existência independente ≠ incapacidade laborativa; INSS gera presunção relativa; cláusula não abusiva por decorrer da predeterminação de riscos, art. 757 do CC; dever de informação é da estipulante no seguro em grupo).
- **Caminho que conduz à procedência** — construído sobre 0002830-89.2013, o único precedente do lado oposto, que reconhece a necessidade de perícia para afastar a presunção do INSS.
- **O que decide este caso** — o ponto concreto e verificável nos autos: comprovar, ou não, a **perda da existência independente** para além da incapacidade laborativa.
- **Dispositivo condicional** — os dois desfechos redigidos por extenso, cada um com a sua consequência sobre honorários.

**Nota do juiz automático: 4,75 de 5** (`openai/gpt-5.6-terra` — fornecedor diferente do redator, de propósito).

| cobertura | fidelidade | coerência | ancoragem |
| :---: | :---: | :---: | :---: |
| 5 | 5 | 4 | 5 |

E a crítica que ele fez, publicada junto:

> *O ponto mais fraco é a fixação condicional dos honorários recursais sobre "valor da condenação", embora a sentença de improcedência não tenha condenação principal.*

**Custo total da consulta: US$ 0,0284** — dois centavos e oitenta e quatro milésimos. Rastro por etapa:

| Nó | Modelo | tokens in/out | US$ |
| --- | --- | ---: | ---: |
| triagem | openai/gpt-5.6-luna | 754 / 343 | 0,0003 |
| triar | google/gemini-3.5-flash-lite | 15.847 / 1.894 | 0,0095 |
| redigir | deepseek/deepseek-v3.2 | 19.439 / 2.585 | 0,0060 |
| revisar | x-ai/grok-4.3 | 4.307 / 562 | 0,0067 |
| juiz | openai/gpt-5.6-terra | 3.268 / 313 | 0,0060 |
| **total** | | | **0,0284** |

Tempo: **65 segundos**.

---

# 7. A igualdade da decisão

Reproduzir a própria conta prova consistência. Não prova acerto. Para acerto existe o teste cego — e ele foi **rodado agora, para este documento**.

## Como o teste funciona

O sistema sorteia decisões **já julgadas**, **esconde cada uma do índice**, e entrega só a parte da ementa que descreve o caso — com um filtro que remove qualquer trecho que revele o desfecho. Depois compara o que ele previu com o que o desembargador de fato decidiu.

Custo: **zero**. Não passa por IA nenhuma. É a espinha do sistema medida sozinha.

```
python -m src.rag.avaliar --offline -n 400
```

## O que saiu

```
cérebro: Rubens Schulz
amostra: 400 decisoes de merito de 2024 em diante, todas classificadas pelo dispositivo

avaliados: 400  (sem precedente: 0)

-- acerto do rotulo (metrica fraca: o prior domina) --
acerto exato ..................... 73.2%
chutar sempre o mais comum ....... 67.5%

-- previsao de REFORMA (e' aqui que esta o sinal) --
quando o sistema diz 'reforma',
  ele acerta (precisao) .......... 72.4%
taxa real de reforma na amostra .. 32.5%   <- a linha de base honesta
ganho sobre a base ............... 2.23x
das reformas reais, quantas ele
  pega (recall) .................. 48.5%
F1 ............................... 58.1%
```

## A matriz — igualdade entre o previsto e o real

400 decisões, o que o desembargador decidiu (linhas) contra o que o sistema previu (colunas):

| real ↓ / previsto → | desprovido | parcialmente | provido | não conhecido | extinto | **total** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **desprovido** | **246** | 10 | 9 | 5 | 0 | 270 |
| **parcialmente provido** | 46 | **14** | 6 | 1 | 1 | 68 |
| **provido** | 24 | 4 | **33** | 1 | 0 | 62 |

A diagonal em negrito é a igualdade: **293 de 400 rótulos idênticos ao real (73,2%)**.

**Como ler isso com honestidade** — e esta é a parte que separa a medição da propaganda:

- **O acerto bruto quase não vale nada.** Duas em cada três decisões são "desprovido"; quem chutasse sempre "desprovido" acertaria 67,5% sem saber nada. O sistema faz 73,2%. A diferença é real, mas é pequena.
- **O produto é a previsão de reforma.** Quando o sistema diz *"esse aqui ele reforma"*, acerta **72,4%** das vezes, contra uma taxa base de **32,5%**. Vale **2,23× o chute**. É esse número que se usa.
- **E o inverso não vale.** Olhe a primeira coluna: 46 parcialmente providos e 24 providos foram previstos como desprovido. Um caso que o sistema não sinaliza **não** é um caso que o desembargador manteria. O sistema pega menos da metade das reformas reais (recall 48,5%) — e isso está impresso no próprio relatório, não escondido.

## Os cinco arranjos, nos mesmos 400 casos

O mesmo teste, rodado com cada peça ligada e desligada — para mostrar que cada componente do sistema **paga o próprio lugar**, e que os números publicados no material comercial reproduzem:

```
python -m src.rag.avaliar --offline -n 400 --comparar
```

```
taxa real de reforma na amostra: 32.5%  <- a linha de base a bater

arranjo                n  exato precisão   recall     F1   ganho
knn                  400  73.2%    72.4%    48.5%  58.1%   2.23x
knn+rerank           400  74.5%    73.9%    50.0%  59.6%   2.27x
floresta             400  50.5%    39.3%    94.6%  55.5%   1.21x
conjunto             400  73.2%    68.0%    63.8%  65.9%   2.09x
conjunto+rerank      400  74.5%    71.2%    68.5%  69.8%   2.19x

-- o que fica ligado --
rerank                 precisão  +1.4 pp | F1  +1.6 pp -> LIGAR
floresta (conjunto)    precisão  -4.4 pp | F1  +7.8 pp -> LIGAR
```

Leia a linha da **floresta sozinha**: 39,3% de precisão — é ruim, e está publicado assim. Mas 94,6% de recall: ela quase não deixa reforma passar. O k-NN é o inverso exato. Juntos, F1 sobe de 58,1% para 69,8%. **É por isso que são dois estimadores, e o número feio do componente isolado vai para o relatório do mesmo jeito.**

## A abstenção, medida

E a tabela que sustenta a afirmação mais forte do sistema — a de que ele acerta 96,7% quando decide responder:

```
-- e se o sistema pudesse dizer 'não sei'? --
regime                               responde    acerta
responde sempre (fase 3)               100.0%     80.2%
margem >= 0,20                          64.2%     89.5%
margem >= 0,25                          46.0%     94.0%
margem >= 0,30                          41.8%     95.2%
margem >= 0,35  <- efetivo              37.8%     96.7%
margem >= 0,45                          29.0%     96.6%
```

O corte em uso é 0,35. O preço de chegar a 96,7% está escrito na coluna do meio: **não responder em 62% das consultas**. Foi exatamente esse corte que produziu o NÃO DECIDO de §5.

## Confronto: o que foi publicado × o que foi medido hoje

| Afirmação em `info.md` | Medido agora | Confere |
| --- | ---: | :---: |
| Contagem ponderada: precisão 72,4% / recall 48,5% | 72,4% / 48,5% | ✔ |
| Random Forest: precisão 39,3% / recall 94,6% | 39,3% / 94,6% | ✔ |
| As duas juntas: 71,2% / 68,5% | 71,2% / 68,5% | ✔ |
| F1 sobe de 58,1% para 69,8% | 58,1% → 69,8% | ✔ |
| Acerto do rótulo: 74,5% | 74,5% (conjunto+rerank) | ✔ |
| Chutar sempre "mantém": 67,5% | 67,5% | ✔ |
| Quando prevê reforma, acerta 71,2% | 71,2% | ✔ |
| Taxa real de reforma: 32,5% | 32,5% | ✔ |
| Vantagem sobre o chute: 2,2× | 2,19× | ✔ |
| Sempre responder: 100% / 80,2% | 100,0% / 80,2% | ✔ |
| Filtro moderado: 64% / 89,5% | 64,2% / 89,5% | ✔ |
| Filtro padrão: 38% / 96,7% | 37,8% / 96,7% | ✔ |

> **12 de 12.** Nenhum número do material de apresentação foi arredondado a favor, e nenhum deixou de reproduzir.

## O número que foi jogado no lixo

A primeira versão da Random Forest marcou **93,9%** de acerto. Não existe previsão judicial com esse número.

O problema: a ementa termina concluindo — *"PLEITO CONHECIDO E ACOLHIDO"* — e era dessa frase que o modelo tirava a resposta. Estava **copiando o gabarito, não prevendo**. O filtro que protegia o teste passou a proteger também o treino (`sem_vazamento`, em `src/rag/classificador.py`), e roda **antes** de qualquer número aparecer na tela.

Os 73,2% acima são o número depois da trava. **Todo número deste documento passou por ela.**

## E o dispositivo da minuta, bate com o real?

Medição separada, com gabarito: 4 processos reais já julgados, minuta gerada por 8 modelos diferentes, o dispositivo comparado com a decisão verdadeira (`output/bench_casos.json`).

| | |
| --- | ---: |
| Gerações avaliadas | 32 |
| Dispositivo igual ao real | **27 (84,4%)** |
| Nota média do juiz automático | 2,96 de 5 |

**A ressalva que precisa vir junto:** os 4 processos sorteados eram **todos "desprovido"**. Então 84,4% aqui mede consistência do redator, **não** capacidade de acertar reforma — para isso vale o teste cego de 400 casos acima, e só ele. Registrar isso é parte do produto.

O que essa medição mostra de útil é outra coisa: **8 de 8 modelos melhoraram** depois que os defeitos de prompt que o teste expôs foram corrigidos (média de 2,39 → 2,96 de 5), e o modelo escolhido custa **3,2× menos** que o mais caro com nota igual ou melhor.

---

# 8. O teste cego em processos reais

Tudo até §7 usou um caso construído. Esta seção faz o teste que importa: **processos reais, já julgados pelo próprio desembargador, com a decisão escondida do índice.** São quatro.

> ### Correção — 16/08/2026
>
> A primeira versão desta seção, publicada mais cedo hoje, trazia dois números errados sobre **um só** dos casos. A causa: o diagnóstico que eu rodei reproduziu o conjunto errado de candidatos. O pipeline (`src/rag/grafo.py:332-335`) puxa **80** decisões do BM25 e o rerank corta para 40; eu havia reordenado apenas os 40 primeiros do BM25.
>
> | Publicado antes | Correto |
> | --- | --- |
> | "dos 40 candidatos, 36 desprovido e 3 reforma" | 35 desprovido, 2 extinto/homologado, 2 provido, 1 não conhecido — **2 reformas em 37 de mérito (5%)** |
> | "134º, fora dos 40 que a triagem lê" | 134º no BM25, e o corte é **80** — ficou **54 posições** fora |
>
> O erro se denunciava sozinho: os 8 precedentes aprovados incluem 2 `extinto/homologado`, e no meu conjunto não havia nenhum. As duas verificações que agora travam esta seção estão em §10. **Nada do prognóstico mudou** — aqueles números vieram da saída do sistema, não do diagnóstico.
>
> Registro isto em vez de corrigir em silêncio pelo mesmo motivo que o documento cobra do sistema: um relatório que esconde o próprio erro não serve como prova de nada.

## A regra de escolha, escrita antes de rodar

Os três processos novos não foram escolhidos a dedo — seria exatamente o viés que este documento acusa. A regra foi fixada antes:

1. **População:** decisões de **2025** (a floresta treinou até 2023), de mérito, com o rótulo tirado do dispositivo, com inteiro teor, e com relatório isolável entre as marcas `RELATÓRIO` e `VOTO`. Resultado: **1.369 processos** elegíveis, 38 descartados por relatório não extraível.
2. **Estrato:** 2 reformas + 1 desprovido. Sortear só reformas mediria o lado que interessa.
3. **Sorteio:** `random.seed(7)`, o mesmo do teste cego de 400 casos. Sem reescolha.
4. **Todos vão para o documento**, decida o sistema ou não, acerte ou não.

## Os quatro processos

| # | Processo | Matéria | Julgado | Resultado real |
| :-: | --- | --- | --- | --- |
| 1 | 0300411-24.2015.8.24.0026 | prescrição intercorrente; abertura de crédito fixo | 11/09/2025 | **PROVIDO** |
| 2 | 5030322-98.2025.8.24.0000 | habilitação de crédito avalizado em recuperação | 26/06/2025 | **PROVIDO** |
| 3 | 5004268-65.2020.8.24.0002 | embargos à execução; CDI como correção monetária | 22/05/2025 | **PROVIDO** |
| 4 | 5029121-31.2024.8.24.0930 | revisional de juros; duas apelações | 15/05/2025 | **DESPROVIDO** (ver ressalva) |

Todos da 6ª Câmara de Direito Comercial, todos por unanimidade.

## Como o teste foi montado

```bash
python -m src.rag.cli exemplos/caso-real-prescricao.txt          --tese neutra --excluir 2836
python -m src.rag.cli exemplos/caso-real-habilitacao-credito.txt --tese neutra --excluir 12779 18943
python -m src.rag.cli exemplos/caso-real-embargos-cdi.txt        --tese neutra --excluir 11398
python -m src.rag.cli exemplos/caso-real-revisional-juros.txt    --tese neutra --excluir 12726 12727
```

- A peça entregue ao sistema é o **relatório do próprio acórdão** — a parte que descreve a sentença e as razões recursais — cortada **antes do voto**. Os arquivos estão em `exemplos/`, para conferência.
- Cada peça passou por uma varredura de marcas de desfecho (`dou-lhe provimento`, `nego provimento`, `conhecido e provido`, `por unanimidade`…). **Nenhuma acusou.** Cuidado deliberado: "requereu o provimento do recurso" é pedido da parte, não desfecho, e por isso a conferência foi humana, não só automática.
- `--excluir` cobre **todos** os ids do mesmo número — dois dos processos têm duas linhas no índice. Sem isso o sistema acharia a resposta e o teste viraria cópia.
- A floresta treinou com decisões até 2023; os quatro acórdãos são de 2025.
- Saídas completas em `output/consultas/cego-*.md`. Custo somado dos quatro: **US$ 0,1387**.

## O resultado: nenhuma resposta, nas quatro

| # | Real | k-NN | Floresta | Conjunto | Calibrado | Margem | Decidiu? |
| :-: | --- | ---: | ---: | ---: | ---: | ---: | :-: |
| 1 | provido | 0,0% | 58,5% | 29,2% | 10,0% | 0,400 | **não** |
| 2 | provido | 55,2% | 69,5% | 62,3% | 69,8% | 0,198 | **não** |
| 3 | provido | 62,6% | 79,2% | 70,9% | 69,8% | 0,198 | **não** |
| 4 | desprovido | 0,0% | 67,8% | 33,9% | 21,2% | 0,288 | **não** |

**Quatro NÃO DECIDO em quatro.** O sistema responde em 37,8% das consultas por projeto (§7), então quatro silêncios seguidos têm ~15% de chance de acontecer — é azar dentro do esperado, não anomalia. E quatro casos não medem taxa de abstenção nenhuma; quem mede isso são os 400 de §7.

O que dá para medir aqui é outra coisa, e é desconfortável nos dois sentidos:

| | |
| --- | ---: |
| Decidiu | **0 de 4** |
| Se tivesse respondido pelo conjunto, acertaria | **3 de 4** |
| A abstenção **evitou** um erro | caso 1 |
| A abstenção **custou** dois acertos | casos 2 e 3 |
| A minuta continha o desfecho real como um dos caminhos | **4 de 4** |

> **Ler isto com honestidade:** a recusa não é grátis e não é só virtude. Ela cortou uma resposta errada e duas certas. É o preço declarado dos 96,7% — não responder em 62% das vezes —, e aqui ele aparece com nome e sobrenome, em vez de percentual.

## Caso 1 — o portão secundário barrou um erro

Este é o achado mais forte dos quatro. O que o sistema imprimiu:

```
# Prognóstico

## NÃO DECIDO

Os dados não sustentam um prognóstico neste caso:

- os dois estimadores discordam demais (58 pontos)

| estimador                | P(reforma) |
|--------------------------|-----------:|
| k-NN sobre precedentes   |       0,0% |
| Random Forest            |      58,5% |
| conjunto                 |      29,2% |
```

**Ele não respondeu.** E é aqui que está o resultado desta seção — porque a alternativa era pior:

| | |
| --- | ---: |
| conjunto, escala calibrada | **10,0%** de chance de reforma |
| margem \|p − 0,5\| | **0,400** |
| corte de margem em uso | 0,35 → **0,400 ≥ 0,35, o portão principal deixaria passar** |
| desacordo entre os estimadores | **0,585** (máximo tolerado: 0,45) |

> **O portão principal falhou. O secundário salvou.** Com margem 0,400 o sistema teria cravado **"MANTÉM, 10% de chance de reforma"** — uma resposta confiante e **errada**, porque o desembargador reformou. Quem barrou foi o sinal de desacordo entre os dois estimadores, que por regra **só rebaixa, nunca promove**.

Isso é exatamente o que está escrito em `src/rag/confianca.py`, decidido antes deste teste existir:

> *"A margem é o portão principal. Os outros três sinais só REBAIXAM — nunca promovem um caso que a margem reprovou. Um sinal fraco não deve poder autorizar o que o sinal forte negou."*

Aqui a regra rodou ao contrário do esperado — um sinal fraco derrubou o que o forte tinha aprovado — e foi o que impediu o erro. **Dá para reproduzir o cálculo inteiro em três linhas de Python; está em §10.**

## E a minuta? Bate com a decisão real?

A minuta saiu com **dispositivo condicional**, dois caminhos. O segundo:

> *"...deve-se **dar provimento** ao recurso, para **reformar a sentença**, afastando o reconhecimento da prescrição intercorrente, e **determinar o retorno dos autos à origem** para o regular prosseguimento da execução."*

O dispositivo real, do acórdão de 11/09/2025:

> *"...conhecer do recurso e **dar-lhe provimento** para **desconstituir a sentença** e **determinar o retorno dos autos à origem para o seu regular processamento**, ante a **inocorrência da prescrição intercorrente**."*

| Elemento | Minuta (caminho 2) | Acórdão real | |
| --- | --- | --- | :---: |
| Desfecho | dar provimento | dar provimento | ✔ |
| Providência | reformar a sentença | desconstituir a sentença | ✔ |
| Fundamento | afastar a prescrição intercorrente | inocorrência da prescrição intercorrente | ✔ |
| Destino dos autos | retorno à origem, regular prosseguimento | retorno à origem, regular processamento | ✔ |
| Honorários recursais | incabíveis na espécie | deixa-se de arbitrar | ✔ |

**O documento que o advogado receberia continha o desfecho correto, redigido, com a providência certa e o fundamento certo** — como um de dois caminhos explícitos, não como aposta.

## O que não bateu — e precisa estar escrito

Três coisas falharam, e omiti-las tornaria esta seção propaganda:

**1. O k-NN apontou 0% de reforma.** Distribuição real dos 40 candidatos que a triagem leu — recomputada com o conjunto certo (80 do BM25 → rerank → 40):

| resultado | n |
| --- | ---: |
| desprovido | 35 |
| extinto/homologado | 2 |
| provido | 2 |
| não conhecido | 1 |

Dos **37 de mérito, só 2 eram reforma — 5%**, contra 32,5% na base. A recuperação puxou o lado errado com força. Se o sistema dependesse só dela, erraria feio.

**2. A busca não achou o precedente decisivo — que é do próprio relator.** O acórdão real se apoia em `0058420-08.2008.8.24.0023` (rel. Des. Rubens Schulz, 6ª Câmara, j. 19/09/2024, **provido**), caso quase idêntico. Ele **está no acervo**. Onde ficou:

| | |
| --- | ---: |
| Posição no BM25 puro | **134º** |
| Quantas o BM25 entrega ao rerank | **80** |
| Entrou nesse conjunto? | **não** — ficou 54 posições fora |

O rerank não teve chance de promovê-lo: só reordena o que o BM25 entrega, e ele não chegou lá. **A recuperação é o gargalo, não o redator** — e isso confirma, num caso real, o que o bench de modelos já tinha dito: *"nenhum modelo reproduz as decisões dele bem — o gargalo não é o modelo."*

**3. A minuta identificou o ponto decisivo errado.** Ela apontou que o caso dependia de *"a data do último ato eficaz e o período de inércia subsequente"*. O acórdão real virou em outro ponto: a sentença **classificou mal o título** — tratou como cédula de crédito bancário (prazo trienal) o que era contrato de abertura de crédito fixo (prazo **quinquenal**, art. 206, § 5º, I, do CC) — e, pela redação original do art. 921 do CPC, o prazo só começou em 19/06/2021. A minuta adotou o prazo quinquenal nos dois caminhos, mas **não identificou a classificação do título como a virada**.

## Casos 2 e 3 — a abstenção custou dois acertos

Nestes dois o sistema apontou o lado **certo** e calou mesmo assim.

| | Caso 2 — habilitação de crédito | Caso 3 — embargos / CDI |
| --- | --- | --- |
| Real | **PROVIDO** | **PROVIDO** |
| k-NN / floresta | 55,2% / 69,5% | 62,6% / 79,2% |
| Conjunto calibrado | **69,8%** → reforma | **69,8%** → reforma |
| Teria acertado? | **sim** | **sim** |
| Portões que barraram | margem 0,198 < 0,35; precedentes divididos (39%); intervalo de 88 pontos | margem 0,198 < 0,35; precedentes divididos (47%); intervalo de 73 pontos |
| Nota do juiz automático | 3,5 | 4,0 |
| Custo | US$ 0,0314 | US$ 0,0332 |

Aqui **o portão principal foi quem barrou** — o oposto do caso 1. Com 69,8% a estimativa aponta reforma, mas fica a 0,198 do meio, e o corte exige 0,35. Some-se a isso que os precedentes recuperados se dividiam quase meio a meio: no caso 2, o peso majoritário tinha só 39% — abaixo do mínimo de 55%.

**E é a decisão de projeto correta, mesmo tendo custado dois acertos.** Um sistema que respondesse com margem de 0,198 responderia também nos casos em que erra com margem de 0,198 — e a tabela de §7 mostra o que acontece nessa faixa: 80,2% de acerto respondendo sempre, contra 96,7% no corte de 0,35. Trocar dois acertos avulsos por 16 pontos de acerto na faixa em que se responde é o negócio que o sistema fez, e está medido.

O que a minuta produziu em cada um:

**Caso 2** — cenário III: *"DAR PARCIAL PROVIMENTO ao recurso para reformar a sentença, declarar o crédito [...] habilitável no processo de recuperação judicial [...] determinar a inclusão do crédito no quadro-geral de credores, na classe quirografária."*
O acórdão real: *"dar-lhe provimento para, com fulcro no art. 487, I, do CPC, acolher a impugnação de crédito"*. **Mesma direção e mesma providência; o real foi integral, a minuta previu parcial.**

**Caso 3** — cenário B: *"acolher a preliminar de cerceamento de defesa, anulando a sentença e determinando o retorno à origem para a realização da perícia contábil."*
O acórdão real: *"dar-lhe provimento para desconstituir a sentença e determinar o retorno dos autos à origem, a fim de que se dê a abertura da fase instrutória."* **Acertou o fundamento vencedor — a preliminar de cerceamento —, a providência e o destino dos autos.**

## Caso 4 — a recuperação acertou em cheio, e o rótulo não é limpo

O único "desprovido" do sorteio, e o caso em que a busca funcionou melhor: os **8 precedentes vieram com analogia 5/5**, todos apelações revisionais contra a mesma instituição (Crefisa), com as mesmas preliminares e o mesmo mérito de juros remuneratórios. Um deles é descrito pela triagem como *"idêntico ao caso"*.

| | |
| --- | ---: |
| k-NN | **0,0%** — os 8 precedentes desprovidos |
| Floresta | 67,8% |
| Conjunto calibrado | 21,2% → mantém |
| Portões que barraram | margem 0,288 < 0,35; desacordo de 68 pontos |
| Custo | US$ 0,0322 |

Aqui o **k-NN acertou e a floresta errou** — o inverso exato do caso 1. É a demonstração viva de por que existem dois estimadores: nenhum dos dois é confiável sozinho, e quando discordam é sinal de fronteira, não de defeito de um deles.

E a minuta reproduziu o acórdão real com precisão incômoda. Caminho 1:

| Item | Minuta | Acórdão real | |
| --- | --- | --- | :-: |
| Recurso da ré | negar provimento | negar provimento | ✔ |
| Recurso da autora | dar parcial provimento | dar parcial provimento | ✔ |
| Margem de tolerância de 50% | extirpar, limitando às médias exatas | extirpar, incidindo de forma isolada | ✔ |
| Honorários de 1ª instância | **negar** a majoração, manter R$ 800 | **majorar** para R$ 2.000 | ✘ |

Três de quatro itens, incluindo o dispositivo principal de cada recurso. Errou o de honorários — e errou **na direção oposta**.

> **A ressalva do rótulo, que precisa vir junto.** O banco classifica este processo como `desprovido`, e foi assim que ele entrou no sorteio como "manutenção". Mas o acórdão real **negou** o recurso da ré **e deu parcial provimento** ao da autora. O rótulo é uma simplificação de um resultado misto. Portanto: o "acertaria" do caso 4 na tabela de placar vale **contra o rótulo do banco**, não contra o acórdão inteiro — e o mesmo vale para qualquer processo com duas apelações em toda a base, inclusive nos 400 casos de §7. É uma limitação do rótulo, não deste teste.

## A leitura correta destes quatro casos

Eles **não** provam que o sistema prevê reformas — ele mesmo diz que pega 48,5% delas, e aqui não previu nenhuma: absteve-se nas quatro.

Provam três coisas mais difíceis de fingir:

1. **A recusa é real e é cara.** Barrou um erro e duas respostas certas. Um sistema desenhado para demonstração teria o corte frouxo o bastante para acertar os casos 2, 3 e 4 e ficar com 3 de 4 na vitrine.
2. **Os dois estimadores se corrigem em direções opostas, e dá para ver acontecendo.** No caso 1 a floresta salvou; no caso 4 o k-NN salvou. Cada um sozinho teria errado um deles.
3. **A minuta entregou o desfecho real nas quatro**, como um dos caminhos explícitos, com a providência certa — inclusive no caso 4, onde acertou o dispositivo dos dois recursos.

E expõem o gargalo com endereço: **a recuperação**. No caso 1 ela deixou o precedente decisivo do próprio relator em 134º; no caso 4 ela trouxe oito acórdãos idênticos e acertou sozinha. A diferença entre um resultado e outro está na busca, não no redator.

---

# 9. A prova que o próprio banco dá

Todos os números estruturais citados em `info.md` foram reconferidos hoje, com consulta direta ao `output/rag.db`:

| Afirmação | Medido agora | Confere |
| --- | ---: | :---: |
| 20.363 decisões no acervo | 20.363 | ✔ |
| Âncora vinculante: 14,5% | 2.952 / 20.363 = 14,50% | ✔ |
| Âncora persuasiva: 50,8% | 10.341 / 20.363 = 50,78% | ✔ |
| Âncora estadual: 34,7% | 7.070 / 20.363 = 34,72% | ✔ |
| Decisões não unânimes: 3,6% | 724 / 20.363 = 3,56% | ✔ |
| Com efeito posterior rastreado: 55,9% | 11.386 / 20.363 = 55,92% | ✔ |
| Taxa de reforma no acervo | 4.891 / 14.657 de mérito = 33,4% | ✔ |

**Nenhuma correção necessária.** As afirmações do material comercial batem com o banco.

## O mesmo caso, três lados — a prova de que o sistema não força

O mesmo `caso.txt` foi rodado três vezes, pedindo três coisas diferentes. Isto é o teste mais desconfortável que se pode fazer numa ferramenta de advocacia, porque expõe a força real da tese:

| Você pediu | Candidatos lidos | Aprovados | Descartados por decidirem contra | Dispositivo da minuta | Custo |
| --- | ---: | ---: | ---: | --- | ---: |
| **neutra** | 40 | 8 | — | condicional (dois cenários) | US$ 0,0284 |
| **reformar** | 80 (duas rodadas) | **3** | **63** | DOU-LHE PROVIMENTO | US$ 0,0412 |
| **manter** | 40 | 8 | **0** | NEGO-LHE PROVIMENTO | US$ 0,0460 |

Leia a coluna do meio. Para sustentar "reformar" neste caso, o sistema teve de **descartar 63 precedentes análogos que decidem contra**, e precisou de **duas rodadas de busca** para achar 3 que ajudassem. Para "manter", nenhum descarte foi preciso.

**Essa é a força do seu caso, escancarada, antes de você entrar com a peça.**

E uma consequência ética embutida: **no modo tese não sai percentual nenhum**. Contar resultado numa amostra escolhida para sustentar um lado mede a sua escolha, não o tribunal. Existe uma verificação automática que **falha de propósito** se qualquer número de prognóstico escapar para uma consulta com tese.

Arquivos: `output/consultas/v2-neutra.md`, `v2-reformar.md`, `v2-manter.md`.

---

# 10. Como refazer esta conta

Nada aqui depende de acreditar em mim. Com o repositório e o banco na mão:

```bash
# 1. o teste cego — 400 decisões já julgadas, escondidas do índice. Custo zero.
python -m src.rag.avaliar --offline -n 400

# 2. os cinco arranjos nos mesmos casos + a tabela de abstenção
python -m src.rag.avaliar --offline -n 400 --comparar

# 3. o rerank explicando a própria ordem, com dados reais
python -m src.rag.rerank "invalidez funcional permanente"

# 4. a consulta inteira, de novo (esta gasta ~US$ 0,03)
python -m src.rag.cli exemplos/caso.txt

# 5. só o prognóstico, sem redator nem juiz
python -m src.rag.cli exemplos/caso.txt --so-prognostico

# 6. a auditoria de deriva de época
python -m src.rag.deriva

# 7. os quatro processos reais de §8 — cada decisão sai do índice
python -m src.rag.cli exemplos/caso-real-prescricao.txt          --tese neutra --excluir 2836
python -m src.rag.cli exemplos/caso-real-habilitacao-credito.txt --tese neutra --excluir 12779 18943
python -m src.rag.cli exemplos/caso-real-embargos-cdi.txt        --tese neutra --excluir 11398
python -m src.rag.cli exemplos/caso-real-revisional-juros.txt    --tese neutra --excluir 12726 12727
```

As duas travas que pegariam de novo o erro corrigido em §8 — o conjunto de candidatos reproduzido
errado. Se qualquer uma falhar, o diagnóstico está errado e não deve ser publicado:

```python
bm80 = busca.buscar(Q, limite=80, excluir=(2836,), banco=cam["rag"])  # o pipeline puxa 80
c40 = rerank.ordenar(bm80, limite=40)                                  # e corta em 40

# trava 1: tem que haver 'extinto/homologado' entre os 40 (havia 2 nos aprovados)
assert any(c["resultado"] == "extinto/homologado" for c in c40)
# trava 2: os 8 precedentes do relatório têm que estar entre os 40
assert all(n in [c["numero"] for c in c40] for n in APROVADOS)   # 8 de 8
```

E o portão de confiança de §8, que é o achado mais importante do documento, refaz-se em três linhas:

```python
from src.rag import calibrar, confianca
p = calibrar.aplicar(0.5 * 0.0 + 0.5 * 0.585)          # k-NN 0% · floresta 58,5%
print(p, abs(p - 0.5))                                  # 0,100 · margem 0,400 -> passaria
print(confianca.avaliar(p, [{"resultado": "desprovido"}] * 8,
                        lambda x: 1.0, knn=0.0, rf=0.585))
# {'decide': False, 'por_que': ['os dois estimadores discordam demais (58 pontos)']}
```

E os campos brutos de qualquer precedente citado, direto no banco:

```sql
SELECT numero, ano, resultado, ancora, unanime, efeito, url
FROM decisao
WHERE numero IN ('0302503-58.2017.8.24.0008',
                 '0002830-89.2013.8.24.0049',
                 '0011166-15.2013.8.24.0039',
                 '0308521-36.2015.8.24.0018',
                 '0004462-43.2009.8.24.0033',
                 '0002592-72.2013.8.24.0016',
                 '0003737-03.2012.8.24.0016',
                 '0313797-96.2016.8.24.0023');
```

Cada linha traz a URL do acórdão no portal do TJSC. **A cadeia vai do número na tela até o documento público, sem elo faltando.**

---

# 11. O que este documento prova — e o que não prova

## Prova

1. **A conta é reproduzível.** 8 de 8 pesos refeitos por fora batem com o relatório, a partir dos campos brutos do banco. A fórmula é fixa, está no código e nos arquivos de configuração — não é o modelo escolhendo o peso que lhe convém.
2. **O prognóstico é reproduzível.** k-NN, floresta, conjunto, calibração e o veredito NÃO DECIDO foram recalculados e deram igual, até a casa decimal.
3. **O sistema recusa responder quando deve.** Tinha 26% pronto na mão e não apresentou como prognóstico, porque a margem não passava do corte medido. É o comportamento mais caro de implementar e o mais fácil de omitir.
4. **Ele bate a linha de base no mundo real.** Na configuração que está em produção, 71,2% de acerto ao prever reforma contra 32,5% de chute — 2,19× —, em 400 decisões já julgadas e escondidas do índice, medido hoje.
5. **Os números do material de apresentação reproduzem.** 12 de 12 conferidos contra a execução de hoje, nenhum arredondado a favor.
5. **Nada é citado sem endereço.** Todo precedente traz o link para o acórdão público.
6. **Ele mostra o que enfraquece a própria tese.** 63 precedentes contrários foram contados e reportados no modo "reformar", em vez de sumirem.
7. **A recusa é real, e é cara.** Em 4 processos reais já julgados (§8) o sistema se absteve nas quatro: barrou um erro e duas respostas certas. Um sistema montado para demonstração teria o corte frouxo o bastante para exibir 3 de 4.
8. **Os dois estimadores se corrigem em direções opostas, e dá para ver acontecendo.** No caso 1 de §8 a floresta salvou o k-NN; no caso 4, o k-NN salvou a floresta. Cada um sozinho teria errado um deles.
9. **Quando erra, o documento diz.** A §8 abre com a correção de dois números que eu publiquei errados hoje, com a causa e as travas que impedem a repetição.

## Não prova

- **Não prova que a minuta está juridicamente certa.** O juiz automático em modo sem gabarito mede coerência interna e fidelidade às fontes. A decisão de estratégia e a peça final são humanas.
- **Não prova nada fora do TJSC.** O acervo é 100% deste tribunal e de um relator só.
- **Não prova que o sistema pegaria toda reforma.** Ele pega 48,5% delas. Um caso não sinalizado não é um caso que seria mantido. Nos 4 testes de §8 ele **não** previu reforma nenhuma — absteve-se em todos.
- **Não prova que a busca acha sempre o precedente certo.** No caso 1 de §8 ela deixou o precedente decisivo do próprio relator em 134º, fora das 80 que o BM25 entrega. A recuperação é o gargalo conhecido do sistema, e está medido aqui.
- **Quatro casos não medem taxa de nada.** A abstenção em 4 de 4 é consistente com os 37,8% de cobertura de §7 (~15% de chance), mas quem mede cobertura são os 400 casos, não estes quatro.
- **O rótulo do banco simplifica resultados mistos.** No caso 4 de §8, `desprovido` esconde que um dos dois recursos foi parcialmente provido. Isso afeta qualquer processo com mais de uma apelação, inclusive dentro dos 400 de §7.
- **Não prova desempenho futuro.** A taxa de reforma varia ~11 pontos de um ano para outro; duas décadas de histórico não descrevem o tribunal de hoje. É por isso que a recência pesa.

---

> **Em uma frase:** uma consulta de 65 segundos e US$ 0,03 produziu oito precedentes com endereço público, oito contas de peso que qualquer pessoa refaz do banco e chega no mesmo número, um prognóstico que o próprio sistema se recusou a dar por falta de margem, e uma minuta que enfrenta os dois lados — enquanto, em 400 decisões já julgadas e escondidas do índice, ele acerta 2,19 vezes mais que o chute quando aponta reforma. Em quatro processos reais já julgados ele se absteve nas quatro — barrando um erro e duas respostas certas —, e ainda assim entregou o desfecho real, redigido, nas quatro.

*Documento gerado em 16/08/2026, com correção declarada em §8 na mesma data. Consultas de referência: `output/consultas/v2-neutra.md` (06/08/2026) e `output/consultas/cego-0300411.md`, `cego-5030322.md`, `cego-5004268.md`, `cego-5029121.md` (16/08/2026 — quatro processos reais, cada um com a própria decisão escondida do índice). Teste cego de 400 casos reexecutado nesta data. Todos os números conferidos contra `output/rag.db`.*
