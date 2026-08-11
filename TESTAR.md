# Testar o sistema

Guia de uso e roteiro de teste da **interface web**. Se você quer só instalar ou
está com erro de subida, o documento é o [COMO_RODAR.md](COMO_RODAR.md) — aqui o
pressuposto é que já está tudo instalado.

**Estado atual desta máquina** (conferido em 07/08/2026):

| o quê                                        | situação                                     |
| -------------------------------------------- | -------------------------------------------- |
| `output\tjsc.db` (1,4 GB, as decisões cruas) | existe                                        |
| `output\rag.db` (índice de busca)            | existe                                        |
| `output\floresta.pkl` + `calibrador.pkl`     | existem                                       |
| conta de acesso                              | `voce@escritorio.com` (admin), já cadastrada  |
| chaves no `.env`                             | OpenRouter e Datajud preenchidas              |

Ou seja: **não falta preparar nada**. É só subir e usar.

---

## 1. Subir (30 segundos)

Um terminal, na raiz do projeto:

```bat
web.bat
```

Espere as duas linhas:

```
[api] http://127.0.0.1:8000
[web] http://localhost:5173  <- abra esta
```

Abra a **5173** no navegador. **Não abra a 8000** — ela é a API crua, sem tela; é
a 5173 que faz o proxy e mantém tudo na mesma origem (é o que faz o cookie de
login grudar).

Para parar: **Ctrl+C** nesse terminal (derruba os dois). Não feche a janela no X
nem mate o processo pelo Gerenciador de Tarefas — no Windows isso deixa o `node`
vivo segurando a porta 5173, e a próxima subida falha.

### Entrar

Email `voce@escritorio.com` e a senha que você cadastrou. Não lembra? Troque:

```bat
.venv\Scripts\python -m api.usuarios --senha voce@escritorio.com
```

Ele pergunta a senha nova duas vezes (mínimo 10 caracteres). Trocar a senha
derruba todas as sessões abertas — é de propósito.

---

## 2. O arquivo: onde, por quê, qual, e se é obrigatório

**Onde:** menu lateral → **Nova consulta**. Logo abaixo da caixa de texto grande
tem um botão **"Escolher arquivo"**.

**Por quê:** só para não ter que colar texto longo à mão. O arquivo sobe, o
servidor extrai o texto dele e despeja o resultado naquela caixa — depois disso o
arquivo não tem mais papel nenhum. **Nada é armazenado**, nada é anexado ao
processo. O que roda a consulta é **o texto que está na caixa**, e só.

Consequência prática: depois de escolher o arquivo, **você pode editar o texto na
caixa** — apagar o cabeçalho, tirar dados do cliente, cortar o que não interessa.
Vale o que ficou na tela.

**Qual arquivo:** `.pdf`, `.docx`, `.txt` ou `.md`. Até 20 MB.

- **PDF comum** (o que sai do PJe, do Word, do "imprimir em PDF"): o texto é lido
  na hora, de graça, sem chamar modelo nenhum.
- **PDF escaneado** (peça digitalizada, sem camada de texto): cai no **OCR**
  automaticamente. Leva alguns segundos a mais e custa cerca de meio centavo de
  dólar — a extração em si é grátis, paga-se só a passagem do texto pelo modelo.
  Enquanto isso a tela mostra *extraindo o texto…*.
- **DOCX**: lido direto, de graça.
- **`.doc` antigo e `.rtf`** não são lidos: abra no Word e salve como `.docx`.
  O erro aparece na tela dizendo isso — não passa lixo adiante.

> **Antes isso não funcionava.** Escolher "Todos os arquivos" e mandar um PDF
> enchia a caixa de lixo binário e a consulta rodava em cima do lixo, gastando
> dinheiro. Agora o tipo do arquivo é conferido **pelo conteúdo, não pela
> extensão**: um binário desconhecido é recusado com mensagem, e nada entra na
> caixa. Vale a pena tentar renomear um `.exe` para `.pdf` e ver.

**Preciso escrever alguma coisa?** Não. **Subir arquivo e digitar são o mesmo
caminho** — os dois só preenchem a mesma caixa. Escolha um:

- **colar** (mais comum): copie a peça do Word/PDF e cole;
- **arquivo**: mais prático para peças longas ou para repetir o mesmo teste
  várias vezes.

**Para o primeiro teste use o arquivo que já está no projeto:**

```
exemplos\caso.txt
```

É uma apelação cível fictícia (seguro de vida em grupo, IPD × IFPD, negativa de
cobertura) escrita justamente para testar. Use ela nos testes 1 a 4 do roteiro
lá embaixo — usando sempre o mesmo caso, as diferenças que você vir vêm das
opções, não do texto.

> **Atenção à diferença:** aqui na Nova consulta o arquivo **substitui** o que
> estiver na caixa — é uma caixa só. No **chat** de uma consulta já pronta o anexo
> **soma** com a pergunta que você escreveu, e os dois vão juntos ao modelo. Ver
> [4.1](#41-anexar-documento-no-chat).

**O que colocar no texto:** fatos, sentença e razões do recurso. Quanto mais
próximo de uma peça real, melhor — é desse texto que sai a busca. Um "quero saber
sobre prescrição" de uma linha não tem material para extrair termo de busca
nenhum, e o resultado sai fraco.

---

## 3. Cada opção da tela "Nova consulta"

### 3.1 Linha de argumentação (obrigatória — vem em "Neutra")

É **a** escolha da tela. Muda o que a triagem faz com os candidatos que o BM25
trouxe.

| opção                       | o que faz                                                                                                        | tem prognóstico? |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Neutra**                  | Mantém os precedentes análogos, decidam para o lado que decidirem.                                                 | **sim**          |
| **Sustentar a reforma**     | A triagem lê o mérito de cada candidato e mantém só os que sustentam **dar provimento**. Reporta quantos descartou. | não              |
| **Sustentar a manutenção**  | O mesmo, do lado de **negar provimento** / manter a sentença.                                                      | não              |

**Por que os modos "sustentar" não dão percentual:** a amostra passou a ser
escolhida por concordar com você. Contar resultado nela mediria a sua escolha, não
o tribunal. O que eles entregam no lugar é mais útil para trabalhar: **quantos
precedentes análogos decidem contra você**. Um "reformar" que descartou 63 e achou
3 já disse muita coisa.

Quer o número calibrado e a munição do seu lado? **Rode as duas.** É o teste 3 do
roteiro.

O corte é semântico, não pelo rótulo `provido`/`desprovido` — esse rótulo só diz
que o *recorrente daquele processo* venceu, e o recorrente de lá pode ser a parte
contrária à sua.

### 3.2 Classe processual (opcional — deixe em "todas")

Restringe a busca a uma classe. **A recomendação do próprio sistema é não usar:**
medido em 400 casos cegos, a precisão fica igual ou levemente pior com o filtro —
ele descarta casos análogos que chegaram por outra via recursal. Use só se souber
por quê. (No roteiro tem um teste para você ver isso acontecer.)

### 3.3 A partir do ano (opcional — deixe vazio)

Corta decisões anteriores ao ano. Serve para quando houve mudança de lei ou virada
de jurisprudência e o material antigo virou ruído. Custo: amostra menor, e amostra
pequena empurra o sistema para o "NÃO DECIDO".

### 3.4 Só o prognóstico (caixa de seleção — desmarcada por padrão)

Para a consulta **antes de escrever a minuta**. Roda triagem → recuperar → triar →
prognóstico e para. É o modo barato: **~US$ 0,010** contra **~US$ 0,03–0,05** da
consulta completa (medido nas 13 consultas já rodadas neste banco; um caso extremo
chegou a US$ 0,15).

> A tela diz "~US$ 0,02 em vez de ~US$ 0,20". O texto está desatualizado — o
> custo real de cada consulta aparece na aba **Custo**, e vem do valor que o
> OpenRouter devolve por chamada, não de estimativa.

Use marcado quando quiser só saber se vale a pena; desmarcado quando quiser a
minuta.

### 3.5 O botão

`rodar prognóstico` ou `rodar consulta completa`, conforme a caixa acima. Ele fica
desabilitado enquanto a caixa de texto estiver vazia. **A partir daqui gasta
dinheiro de verdade.** A tela pula direto para a consulta e mostra o andamento ao
vivo.

---

## 4. O que aparece depois

Enquanto roda: o **desenho do pipeline** com os nós acendendo um a um (triagem →
recuperar → triar → prognóstico → redigir → revisar → julgar), o modelo usado em
cada um, os tokens e o gasto acumulado. Os dois arcos por cima são os ciclos: a
busca pode voltar atrás se trouxer poucos precedentes, e o revisor pode mandar o
redator reescrever. Leva minutos — pode deixar a aba aberta, a página se atualiza
sozinha.

Terminado, seis abas:

| aba              | o que tem                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evidências**   | Como o sistema leu o seu caso, os precedentes recuperados (cada um com ficha de procedência, nota de analogia 0–5 e por que ficou nessa posição) e a contagem sobre o acervo inteiro. **É a aba principal.** |
| **Prognóstico**  | O percentual de reforma — ou "NÃO DECIDO", ou "SEM PROGNÓSTICO". Traz os dois estimadores separados e o campo para você dar sua nota.                        |
| **Minuta**       | O texto redigido pela IA, mais as ressalvas do revisor que não foram corrigidas e a nota do juiz automático.                                                 |
| **Pesos**        | Quanto cada precedente pesou na conta e a curva de calibração.                                                                                               |
| **Rede**         | Grafo: caixas são âncoras (súmulas, temas repetitivos, IRDR) citadas por duas ou mais decisões; traço cheio é apoio, tracejado é ementa parecida. Clique num círculo para abrir a decisão. |
| **Custo**        | Quanto custou cada nó, em tokens e em dólar.                                                                                                                 |

Três coisas que valem clicar:

- **"serviu" / "não serviu"** em cada precedente (aba Evidências) — move o
  precedente nas buscas seguintes, no máximo ±30%.
- **nota 0–5** (aba Prognóstico) — é o que mede se o juiz automático concorda com
  você. Sem isso, comparar modelos é comparar às cegas.
- **"perguntar sobre esta análise"** (topo) — chat sobre a consulta. **Não faz
  busca nova**: responde a partir dos precedentes já recuperados. Custa centavos e
  responde em segundos. **Aceita anexo** — ver 4.1.

### 4.1 Anexar documento no chat

O chat tem o mesmo botão de arquivo da Nova consulta, mas com uma diferença que
importa: aqui ele **acrescenta**, não substitui. Escreva a pergunta, anexe o
arquivo (`.pdf`, `.docx`, `.txt` ou `.md` — as mesmas regras e o mesmo OCR da
seção 2), e os dois vão juntos na mesma mensagem — a pergunta diz o que você
quer, o documento é o material.

Serve para confrontar a análise com algo que ela não viu: as contrarrazões, um
parecer, o acórdão de um caso parecido, a sentença completa. Perguntas do tipo
*"isto aqui derruba o precedente 0301234?"* ou *"o que desta petição a minuta
deixou de responder?"*.

Três coisas para saber:

- **O anexo é material seu, não do acervo.** O modelo é instruído a usá-lo para
  responder, mas a não citá-lo como precedente do relator nem misturá-lo com a
  lista recuperada — e a dizer quando ele contradiz a análise.
- **Continua não havendo busca nova.** Anexar um documento não traz precedentes
  novos do acervo; para isso, consulta completa.
- **Limite de 50.000 caracteres** por mensagem (pergunta + anexo somados) — cabe
  uma petição de ~25 páginas inteira. Se passar, o corte não é silencioso: o
  modelo é avisado e tem de dizer na resposta que não leu o documento inteiro.
  Para peças maiores, corte o trecho que interessa antes de anexar.

No histórico o anexo aparece dobrado, atrás de um "documento anexado — N
caracteres" clicável, para não empurrar a conversa para fora da tela.

E **"baixar .md"** salva o relatório inteiro. Ele também já está em
`output\consultas\<thread>.md`.

### As três respostas possíveis do prognóstico

1. **"X% de chance de reforma"** — número calibrado. Aferido em 1.092 decisões de
   2025 que ficaram fora do ajuste.
2. **"NÃO DECIDO"** — os dados não sustentam prognóstico neste caso, e a tela lista
   por quê. **Não é defeito, é o comportamento projetado**: nessa faixa o sistema
   acertaria ~70%, contra ~96,7% quando crava. Ele crava em ~38% das consultas. As
   evidências continuam valendo.
3. **"SEM PROGNÓSTICO — você pediu um lado"** — você escolheu reformar ou manter.
   Ver 3.1.

---

## 5. As outras telas

| tela             | para quê                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Consultas**    | A lista do que você já rodou, com prognóstico, sua nota, a do juiz e o custo. Gasto do mês no topo. Consultas rodadas pelo terminal aparecem marcadas como "terminal". |
| **Acervo**       | Busca direta nas 20 mil decisões, sem IA e **sem gastar nada**. Filtro por classe, resultado e âncora. Clicando numa decisão você vê ementa, dispositivo, inteiro teor e link para o TJSC. |
| **Estatísticas** | Taxa de reforma por ano/classe/câmara, se o resultado depende de algo que não deveria (dia da semana, carga do dia), a curva de calibração e o livro-caixa. |
| **O modelo**     | Qual modelo roda em cada nó, a topologia real do grafo lida do servidor, os portões que fazem o sistema se recusar a responder e o efeito acumulado dos seus "serviu/não serviu". |
| **Conta**        | Suas sessões abertas e, como admin, criar/desativar usuários. Não há auto-cadastro; cada advogado vê só as consultas dele, o admin vê todas. |

---

## 6. Roteiro de teste

Ordem pensada para ir do gratuito ao caro. Custo total: **menos de US$ 0,25**.

### Teste 0 — nada quebrado (grátis, ~2 min)

Com o servidor **parado**:

```bat
verificar.bat
```

Tem de terminar com `TUDO OK`. Roda os self-checks de todos os módulos, sem rede e
sem gastar nada.

- [ ] terminou com `TUDO OK`

### Teste 1 — passear sem gastar (grátis, ~5 min)

Suba (`web.bat`), entre, e sem rodar consulta nenhuma:

- [ ] **Acervo** → buscar `prescrição intercorrente` → vêm decisões ordenadas por
      BM25, cada uma explicando a própria posição
- [ ] clicar numa decisão → abre ementa, dispositivo e inteiro teor; o link "ver no
      TJSC" abre o processo no portal
- [ ] **Estatísticas** → o gráfico de deriva por ano carrega
- [ ] **O modelo** → a tabela "um modelo por nó" mostra os modelos carregados
- [ ] **Consultas** → aparecem as consultas antigas do terminal, marcadas "terminal"

Se tudo isso funciona, a instalação está inteira: banco, índice, floresta,
calibrador e login.

### Teste 2 — o caminho barato (~US$ 0,010, ~1 min)

**Nova consulta** → botão de arquivo → `exemplos\caso.txt` → deixe **Neutra**,
sem filtros → **marque "Só o prognóstico"** → rodar.

- [ ] o texto do arquivo apareceu na caixa
- [ ] o pipeline acende os nós um a um e para depois de `prognóstico`
- [ ] a aba **Evidências** lista precedentes com nota de analogia
- [ ] a aba **Prognóstico** mostra um percentual **ou** "NÃO DECIDO" com os motivos
- [ ] a aba **Minuta** diz que a consulta parou antes de redigir
- [ ] a aba **Custo** mostra ~US$ 0,01

### Teste 3 — a mesma peça, os três lados (~US$ 0,12, ~10 min)

Rode `exemplos\caso.txt` **três vezes**, sem "só prognóstico", mudando só a linha
de argumentação: **Neutra**, depois **Sustentar a reforma**, depois **Sustentar a
manutenção**.

É o teste que mostra o que o sistema realmente faz:

- [ ] a neutra tem percentual; as outras duas dizem "SEM PROGNÓSTICO — você pediu
      um lado"
- [ ] nos modos "sustentar" aparece a seção **Linha de argumentação** com quantos
      candidatos foram descartados por decidirem **contra** o seu lado
- [ ] os precedentes listados **são diferentes** entre reformar e manter
- [ ] cada uma tem uma **Minuta** escrita, com as ressalvas do revisor quando houve
- [ ] compare os números de descarte: o lado que descarta muito e acha pouco é o
      lado frágil deste caso

> Se um dos lados vier com zero precedentes, isso é achado, não falha: no acervo
> deste relator não há material para essa linha.

### Teste 4 — o filtro que não ajuda (~US$ 0,04, ~3 min)

Mesma peça, **Neutra**, mas agora escolha a classe **Apelação Cível** no seletor.

- [ ] a lista de precedentes encolheu ou mudou
- [ ] o prognóstico ficou igual, pior, ou virou "NÃO DECIDO"

É o teste que justifica o aviso da tela. Filtrar por classe descarta análogos que
vieram por agravo ou embargos.

### Teste 5 — feedback e conversa (~US$ 0,01, ~5 min)

Abra qualquer consulta terminada:

- [ ] marque **"não serviu"** num precedente ruim e **"serviu"** num bom
- [ ] em **O modelo** → seção final, os dois aparecem na tabela de ajuste, com o
      fator (máx. 1,30× / mín. 0,70×)
- [ ] dê uma **nota 0–5** na aba Prognóstico → ela aparece na lista de Consultas, ao
      lado da nota do juiz automático
- [ ] **"perguntar sobre esta análise"** → pergunte algo como *"o que precisaria
      estar provado nos autos para virar o resultado?"* → responde em segundos, por
      centavos
- [ ] **agora com anexo**: escreva *"este documento contradiz algum dos precedentes
      que você usou?"*, anexe `exemplos\caso.txt` e envie
- [ ] o que você escreveu **continuou lá** depois de escolher o arquivo (o anexo é
      acrescentado, não substitui)
- [ ] a resposta trata **dos dois** — responde à pergunta e comenta o documento
- [ ] no histórico, o anexo aparece dobrado; clicar em "documento anexado — N
      caracteres" abre o texto
- [ ] **"baixar .md"** → o arquivo abre com o relatório inteiro

### Teste 6 — o terminal (opcional, ~US$ 0,01)

Se você quiser conferir que a linha de comando faz o mesmo:

```bat
consultar.bat exemplos\caso.txt --so-prognostico
```

- [ ] roda e imprime o relatório no terminal
- [ ] o mesmo relatório aparece em `output\consultas\`
- [ ] **e aparece na lista de Consultas da web**, marcado como "terminal"

Consulta que não gasta nada, para ver o que você já usou:

```bat
consultar.bat --historico seguro
```

---

## 7. Duas coisas para não esquecer

**Cada clique em "rodar" gasta dinheiro de verdade.** Não há confirmação. Antes de
rodar a mesma peça pela quarta vez, veja se a resposta já não está numa consulta
anterior — ou use o chat, que é ordens de grandeza mais barato.

**O relatório não decide.** Ele põe as evidências na mesa: decisões públicas do
relator, contadas e ordenadas, mais uma minuta gerada por IA a partir delas. Não é
a posição do desembargador e não deve ser apresentada como tal. **Confira cada
citação** — o link "ver no TJSC" está em todo precedente exatamente para isso.

---

## 8. Deu errado?

A lista completa de sintomas e conserto está em
[COMO_RODAR.md, seção 5](COMO_RODAR.md#5-quando-dá-errado). Os três mais comuns:

| sintoma                                    | conserto                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| "porta 8000 já está ocupada"               | sobrou processo de antes. O comando para matar vem impresso junto com o erro.                          |
| login volta para a tela de entrar          | cookie sendo descartado. Suba com `web.bat` (que liga `WEB_DEV=1`), não com `--prod` sem HTTPS.         |
| a consulta parou no meio (crédito, internet) | nada foi perdido. Abra a consulta e clique em **retomar de onde parou** — não repaga o que já saiu. |
