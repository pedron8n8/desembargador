# Extensão eproc — núcleos de B e C que não dependem do HAR do TJSC: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar tudo o que os subprojetos B ("Analisar este processo") e C (busca por CPF/CNPJ) precisam e que **não** depende de ver uma tela do eproc do TJSC: o campo `origem` no backend, a minimização de dados, a seleção e a montagem do caso, o casamento relator ↔ cérebro, a validação de CPF/CNPJ e a leitura da resposta da busca.

**Architecture:** Contract-first. `agente/lib/caso.ts` define os tipos (`Peca`, `Capa`) que as primitivas de rede da B (plano futuro, depende do HAR) vão produzir; todo o resto trabalha contra esse contrato, em módulos TypeScript puros testados com `node --test`. No backend, a consulta ganha uma origem opcional (`{eproc, instancia}`), validada antes de qualquer custo de LLM.

**Tech Stack:** TypeScript (só sintaxe apagável: o Node 25 roda `.ts` direto), `node --test`; Python/FastAPI e o self-check `api/smoke.py` existente.

**Specs:** `docs/superpowers/specs/2026-09-29-eproc-analisar-processo-design.md` (B) e `docs/superpowers/specs/2026-09-29-eproc-busca-documento-design.md` (C). Base já implementada: `docs/superpowers/plans/2026-09-29-eproc-extensao-base.md`.

### O que fica de fora (plano futuro, depende do HAR do TJSC)

- As primitivas de rede: `processo()`, `eventos()`, `documento()` (B) e `buscarPorDocumento()` com a leitura da tela de consulta (C).
- As telas do painel para B e C, e a leitura do `max_chars_caso` em `GET /api/config` (o campo `busca.max_chars_caso` já existe lá; `montarCaso` só recebe o número).
- A confirmação dos códigos de tipo de documento do TJSC (ver `TIPOS` na Task 3).
- **Limitação conhecida da minimização:** CPF/CNPJ escritos com espaços no lugar da pontuação (`529 982 247 25`) não são reconhecidos. Reconhecer isso arriscaria apagar datas e valores; fica como está até o HAR mostrar como o TJSC escreve.
- **Obrigações do plano das telas (B2/C2), apontadas na revisão final:**
  - o painel deve bloquear ou avisar antes de enviar um caso com mais de 120.000 caracteres: o servidor recusa com 413 (`MAX_CHARS_CASO` em `api/app.py`), e `montarCaso` só conhece o limite de leitura (`busca.max_chars_caso`, 20.000 por padrão);
  - `montarCaso` pode devolver `excede: true` com `cortadas` vazia (o cabeçalho sozinho já passa do limite): a tela precisa tratar esse caso;
  - a tela deve chamar `bloqueadasPorSigilo` e avisar quando a sentença ou outra peça-chave está em sigilo;
  - quem produzir `Peca` e `Capa` a partir do HTML do TJSC converte `evento` com `Number()` (NaN é `LAYOUT`), trata nível de sigilo desconhecido como sigiloso e passa todo texto por `minimizar`;
  - confirmar no HAR do TJSC os códigos `APELACAO`, `AGRAVO` e `CONT` em `TIPOS`.

## Global Constraints

- Nenhum dado real de processo em código, teste, commit ou relatório: as fixtures usam só os dados fictícios do guia (CNPJ `11.222.333/0001-81`, CPF `529.982.247-25`, CNPJ alfanumérico `12.ABC.345/01DE-35`, processo `5001234-56.2020.8.24.0023` = `50012345620208240023`).
- Nunca abrir nem commitar `*.har` (há um na raiz do repositório, com dados reais de pessoas).
- CPF, CNPJ e OAB saem do texto **dentro do agente**, antes de o texto chegar ao painel ou ao servidor.
- Sigiloso nunca sai; na dúvida (campo ausente, item nulo) conta como sigiloso.
- Layout inesperado é `LAYOUT`, nunca resultado vazio.
- TypeScript apagável apenas: sem `enum`, sem `namespace`, sem parâmetro-propriedade (`constructor(public x)`). Imports com extensão `.ts`.
- Comentários em português, no estilo do código vizinho.
- Backend: a validação de `origem` vem antes do cerebro e do pool; **nenhum teste pode disparar uma consulta real** (gasta LLM).
- Git: um commit por tarefa, só com os arquivos da tarefa (`git add <caminhos>`, nunca `git add -A`). **Nunca** `git commit --amend`, `rebase` ou `reset`. Mensagem em português, em minúsculas, seguida de linha em branco e de `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (use `git commit -F <arquivo>` com o arquivo fora do repositório).
- Comandos do frontend rodam em `frontend/`; os do backend rodam na raiz, com `.venv\Scripts\python.exe -X utf8`.

## Review Focus

1. **Limite do caso inválido** (indefinido, NaN, zero): faria `excede` ser sempre falso e o aviso de corte sumiria calado. Esperado: `montarCaso` falha alto. Teste na Task 4.
2. **Item nulo ou não-objeto na lista de resultados da busca:** não pode virar exceção crua nem passar como público. Esperado: conta como sigiloso. Teste na Task 7.
3. **Texto vazio ou enorme na minimização:** deve terminar sem travar nas expressões regulares. Teste na Task 2.
4. **Duas peças com o mesmo número de evento:** a escolha da pré-seleção tem de ser estável. Teste na Task 3.
5. **Relator que é só um título ("Desembargador"):** não pode casar com nenhum cérebro. Teste na Task 5.

(A origem malformada, o maior risco do backend, já é o núcleo da Task 1.)

---

## Estrutura de arquivos

```
api/
  esquema.py            (mod)  duas colunas: execucao.origem_eproc, execucao.origem_instancia
  execucao.py           (mod)  iniciar(..., origem=None) grava as colunas
  app.py                (mod)  _origem(corpo); rodar() valida e repassa; detalhe() devolve `origem`
  smoke.py              (mod)  testes da origem
frontend/extensao/
  agente/lib/
    numero.ts           (novo) número CNJ de 20 dígitos -> formato de exibição
    minimizacao.ts      (novo) tira CPF, CNPJ e OAB do texto
    minimizacao.test.ts (novo) cobre numero.ts e minimizacao.ts
    caso.ts             (novo) tipos Peca e Capa (o contrato da B)
    documento.ts        (novo) validação e máscara de CPF/CNPJ (numérico e alfanumérico)
    documento.test.ts   (novo)
    busca.ts            (novo) corpo do POST da busca e leitura da resposta
    busca.test.ts       (novo)
  painel/caso/
    pecas.ts            (novo) TIPOS e preselecionar()
    pecas.test.ts       (novo)
    montagem.ts         (novo) montarCaso()
    montagem.test.ts    (novo)
    relator.ts          (novo) cerebroDoRelator()
    relator.test.ts     (novo)
```

`npm run test:extensao` já roda `extensao/**/*.test.ts` e `npx tsc --noEmit` já inclui `extensao`: nenhuma configuração muda.

---

### Task 1: `origem` da consulta no backend

**Files:**
- Modify: `api/esquema.py` (função `_migrar`), `api/execucao.py` (função `iniciar`), `api/app.py` (nova `_origem`, `rodar`, `detalhe`), `api/smoke.py`

**Interfaces:**
- Produces: `_origem(corpo: dict) -> {"eproc": str, "instancia": "1g"|"2g"} | None` (lança `HTTPException(400)` se inválida); `execucao.iniciar(thread, email, caso, ..., origem=None)`; colunas `execucao.origem_eproc` e `execucao.origem_instancia` (NULL fora do eproc); `GET /api/consultas/{thread}` passa a devolver `origem: {eproc, instancia} | None`.

**Atenção:** o Step 1 põe as asserções de `_origem` **antes** de qualquer `POST`. Isso é de propósito: com o código antigo, um `POST /api/consultas` com `caso: "x"` seria aceito e dispararia uma consulta real (custo de LLM). A primeira asserção tem de falhar com `AttributeError` antes de qualquer requisição.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/smoke.py`, junto dos outros imports de módulos locais (depois de `from . import auth  # noqa: E402`), acrescente:

```python
from . import execucao                             # noqa: E402
```

Ainda em `api/smoke.py`, logo depois do bloco `# --- validacao de entrada` (isto é, depois do `assert cli.post("/api/consultas", json={"caso": "x", "tese": "inventada"}, ...).status_code == 400`) e antes de `# --- acervo`, acrescente:

```python
        # --- origem (consulta que veio da extensao do eproc). Primeiro a funcao pura,
        # SEM nenhum POST: se ela ainda nao existir, o smoke tem de cair aqui, e nao
        # depois de um POST aceito por engano (que rodaria LLM de verdade).
        assert modulo_app._origem({}) is None
        assert modulo_app._origem({"origem": None}) is None
        assert modulo_app._origem({"origem": {"eproc": "5" * 20, "instancia": "2g",
                                              "extra": "ignorado"}}) == \
            {"eproc": "5" * 20, "instancia": "2g"}

        # formato invalido e' 400; a validacao vem antes do cerebro e do pool, entao
        # nao gasta LLM
        for ruim in ("x", "", {}, {"eproc": "123", "instancia": "1g"},
                     {"eproc": "5" * 20, "instancia": "3g"},
                     {"eproc": 5 * 10 ** 19, "instancia": "1g"},
                     {"eproc": "5" * 20}):
            assert cli.post("/api/consultas", json={"caso": "x", "origem": ruim},
                            headers=CAB).status_code == 400, ruim

        # ... e a origem valida vira coluna. Chama iniciar() com o pool trocado por
        # um que nao roda nada: rodar de verdade gastaria LLM.
        class _SemPool:
            def submit(self, *a, **k):
                return None

        pool_real = execucao.pool
        execucao.pool = lambda: _SemPool()
        try:
            execucao.iniciar("t-origem", "adv@teste.com", "caso",
                             origem={"eproc": "5" * 20, "instancia": "2g"})
            execucao.iniciar("t-sem-origem", "adv@teste.com", "caso")
        finally:
            execucao.pool = pool_real
        c = esquema.db()
        try:
            linha = lambda t: tuple(c.execute(          # noqa: E731
                "SELECT origem_eproc, origem_instancia FROM execucao WHERE thread=?",
                (t,)).fetchone())
            assert linha("t-origem") == ("5" * 20, "2g"), linha("t-origem")
            assert linha("t-sem-origem") == (None, None)
            # nao ficar na fila: essas linhas contariam para o teto de consultas vivas
            with c:
                c.execute("UPDATE execucao SET estado='pronto' "
                          "WHERE thread IN ('t-origem','t-sem-origem')")
        finally:
            c.close()
```

- [ ] **Step 2: Rodar e ver falhar**

Run (na raiz): `.venv\Scripts\python.exe -X utf8 -W ignore -m api.smoke`
Expected: FAIL com `AttributeError: module 'api.app' has no attribute '_origem'`, **antes** de qualquer POST de origem. Se falhar por outro motivo, ou se o smoke passar, pare e investigue: não siga adiante.

- [ ] **Step 3: Implementar**

Em `api/esquema.py`, na função `_migrar`, troque:

```python
    c.execute("CREATE INDEX IF NOT EXISTS ix_exec_comparacao ON execucao(comparacao)")
    return feito
```

por:

```python
    c.execute("CREATE INDEX IF NOT EXISTS ix_exec_comparacao ON execucao(comparacao)")
    # De onde veio a consulta, quando veio do eproc (extensao): numero do processo
    # (20 digitos) e instancia ('1g'|'2g'). NULL em toda consulta feita no site.
    if _coluna(c, "execucao", "origem_eproc", "origem_eproc TEXT"):
        feito.append("execucao.origem_eproc")
    if _coluna(c, "execucao", "origem_instancia", "origem_instancia TEXT"):
        feito.append("execucao.origem_instancia")
    return feito
```

Em `api/execucao.py`, troque o começo de `iniciar`:

```python
def iniciar(thread, email, caso, tese="neutra", filtros=None, so_prognostico=False,
            cerebro=None, comparacao=None):
    cerebro = cerebros.resolver(cerebro)
    c = db()
    try:
        with c:
            # COLUNAS NOMEADAS. A versao posicional (8 '?') quebrava assim que a
            # tabela ganhasse uma coluna — e ganhou duas nesta fase.
            c.execute(
                "INSERT OR REPLACE INTO execucao "
                "(thread, email, estado, criado_em, so_prognostico, cerebro, "
                " comparacao) VALUES (?,?,?,?,?,?,?)",
                (thread, email, "fila", _agora(), int(bool(so_prognostico)),
                 cerebro, comparacao))
```

por:

```python
def iniciar(thread, email, caso, tese="neutra", filtros=None, so_prognostico=False,
            cerebro=None, comparacao=None, origem=None):
    """`origem`: {'eproc': '<20 digitos>', 'instancia': '1g'|'2g'} quando a
    consulta veio da extensao do eproc; None quando veio do site."""
    cerebro = cerebros.resolver(cerebro)
    origem = origem or {}
    c = db()
    try:
        with c:
            # COLUNAS NOMEADAS. A versao posicional (8 '?') quebrava assim que a
            # tabela ganhasse uma coluna — e ganhou duas nesta fase.
            c.execute(
                "INSERT OR REPLACE INTO execucao "
                "(thread, email, estado, criado_em, so_prognostico, cerebro, "
                " comparacao, origem_eproc, origem_instancia) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (thread, email, "fila", _agora(), int(bool(so_prognostico)),
                 cerebro, comparacao, origem.get("eproc"), origem.get("instancia")))
```

Em `api/app.py`, logo antes de `def _novo_thread(c, sufixo=""):`, acrescente:

```python
def _origem(corpo):
    """De onde veio a consulta: {'eproc': '<20 digitos>', 'instancia': '1g'|'2g'}
    quando veio da extensao do eproc, None quando veio do site. Formato invalido
    e' 400: gravar lixo aqui viraria "veio do eproc, processo <lixo>" no site."""
    o = corpo.get("origem")
    if o is None:
        return None
    if (not isinstance(o, dict) or not isinstance(o.get("eproc"), str)
            or not re.fullmatch(r"\d{20}", o["eproc"])
            or o.get("instancia") not in ("1g", "2g")):
        raise HTTPException(400, "origem inválida: use {eproc: 20 dígitos, "
                                 "instancia: '1g' ou '2g'}")
    return {"eproc": o["eproc"], "instancia": o["instancia"]}


```

Ainda em `api/app.py`, na rota `rodar` (`POST /api/consultas`), troque:

```python
    caso, tese, filtros = _pedido(corpo)
    if execucao.vivas_de(c, u["email"]) >= MAX_VIVAS_POR_USUARIO:
        raise HTTPException(429, "você já tem %d consultas na fila; espere uma "
                                 "terminar" % MAX_VIVAS_POR_USUARIO)
    cerebro = _cerebro_para_rodar(corpo.get("cerebro"))
    thread = _novo_thread(c)
    execucao.iniciar(thread, u["email"], caso, tese=tese, filtros=filtros,
                     so_prognostico=bool(corpo.get("so_prognostico")),
                     cerebro=cerebro)
    return {"thread": thread, "cerebro": cerebro}
```

por:

```python
    caso, tese, filtros = _pedido(corpo)
    origem = _origem(corpo)
    if execucao.vivas_de(c, u["email"]) >= MAX_VIVAS_POR_USUARIO:
        raise HTTPException(429, "você já tem %d consultas na fila; espere uma "
                                 "terminar" % MAX_VIVAS_POR_USUARIO)
    cerebro = _cerebro_para_rodar(corpo.get("cerebro"))
    thread = _novo_thread(c)
    execucao.iniciar(thread, u["email"], caso, tese=tese, filtros=filtros,
                     so_prognostico=bool(corpo.get("so_prognostico")),
                     cerebro=cerebro, origem=origem)
    return {"thread": thread, "cerebro": cerebro}
```

E na rota `detalhe` (`GET /api/consultas/{thread}`), troque:

```python
    d["erro"] = r["erro"] if r else None
    d["proximo_no"] = st.next[0] if st.next else None
    return d
```

por:

```python
    d["erro"] = r["erro"] if r else None
    d["origem"] = ({"eproc": r["origem_eproc"], "instancia": r["origem_instancia"]}
                   if r and r["origem_eproc"] else None)
    d["proximo_no"] = st.next[0] if st.next else None
    return d
```

- [ ] **Step 4: Rodar e ver passar**

Run (na raiz): `.venv\Scripts\python.exe -X utf8 -W ignore -m api.smoke`
Expected: termina com `self-check OK — auth, CSRF, papéis ...`.

Run: `.venv\Scripts\python.exe -X utf8 -m api.esquema`
Expected: termina com `self-check OK — esquema cria, migra de um web.db antigo sem perder dado, e é idempotente`.

O campo `origem` de `GET /api/consultas/{thread}` não tem teste automático: exigiria um checkpoint do LangGraph. Confira só por leitura que o trecho acima foi aplicado.

- [ ] **Step 5: Commit**

```bash
git add api/esquema.py api/execucao.py api/app.py api/smoke.py
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "consulta guarda a origem no eproc (processo e instancia), validada antes do LLM"
```

---

### Task 2: Número do processo e minimização de dados

**Files:**
- Create: `frontend/extensao/agente/lib/numero.ts`, `frontend/extensao/agente/lib/minimizacao.ts`
- Test: `frontend/extensao/agente/lib/minimizacao.test.ts` (cobre os dois módulos)

**Interfaces:**
- Produces: `formatarNumeroProcesso(nr: string): string`; `minimizar(texto: string): string`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/extensao/agente/lib/minimizacao.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatarNumeroProcesso } from './numero.ts'
import { minimizar } from './minimizacao.ts'

test('número do processo: 20 dígitos ganham a pontuação CNJ; o resto volta como veio', () => {
  assert.equal(formatarNumeroProcesso('50012345620208240023'), '5001234-56.2020.8.24.0023')
  assert.equal(formatarNumeroProcesso('123'), '123')
  assert.equal(formatarNumeroProcesso('5001234-56.2020.8.24.0023'), '5001234-56.2020.8.24.0023')
})

test('CPF e CNPJ com máscara, inclusive o CNPJ alfanumérico', () => {
  assert.equal(minimizar('CPF 529.982.247-25 e CNPJ 11.222.333/0001-81.'), 'CPF [CPF] e CNPJ [CNPJ].')
  assert.equal(minimizar('empresa 12.ABC.345/01DE-35 ltda'), 'empresa [CNPJ] ltda')
})

test('CPF e CNPJ sem máscara (11 e 14 dígitos isolados)', () => {
  assert.equal(minimizar('doc 52998224725 e 11222333000181'), 'doc [CPF] e [CNPJ]')
})

test('o número do processo nunca é tocado', () => {
  for (const n of ['50012345620208240023', '5001234-56.2020.8.24.0023']) {
    assert.equal(minimizar('processo ' + n + ' distribuído'), 'processo ' + n + ' distribuído')
  }
})

test('OAB em todas as formas vistas', () => {
  assert.equal(minimizar('OAB/SC 12.345'), '[OAB]')
  assert.equal(minimizar('OAB-RS nº 123456'), '[OAB]')
  assert.equal(minimizar('OAB RS 12345A'), '[OAB]')
  assert.equal(minimizar('oab/sc 12345'), '[OAB]')
  assert.equal(minimizar('Advogado: FULANO DE TAL (RS012345)'), 'Advogado: FULANO DE TAL ([OAB])')
})

test('texto sem identificador fica igual, e minimizar é idempotente', () => {
  const t = 'O autor pede a reforma da sentença de 10/03/2025, valor de R$ 1.500,00.'
  assert.equal(minimizar(t), t)
  const sujo = 'CPF 529.982.247-25 OAB/SC 12.345'
  assert.equal(minimizar(minimizar(sujo)), minimizar(sujo))
})

test('sigla de juízo parecida com UF não é confundida com OAB', () => {
  assert.equal(minimizar('juízo RSPOA14S'), 'juízo RSPOA14S')
})

test('texto vazio e texto enorme: termina, sem travar nas expressões regulares', () => {
  assert.equal(minimizar(''), '')
  const enorme = 'a1 '.repeat(40000) + '529.982.247-25 ' + '12.345.678/9012'.repeat(5000)
  assert.ok(minimizar(enorme).includes('[CPF]'))
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/agente/lib/minimizacao.test.ts`
Expected: FAIL, `Cannot find module ... numero.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/agente/lib/numero.ts`:

```ts
// Número CNJ de 20 dígitos (sem pontuação, como vem no JSON de busca do eproc)
// para o formato de exibição NNNNNNN-DD.AAAA.J.TR.OOOO. Qualquer outra coisa
// volta como veio: melhor mostrar o texto original do que inventar formato.
export function formatarNumeroProcesso(nr: string): string {
  return /^\d{20}$/.test(nr) ? nr.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6') : nr
}
```

`frontend/extensao/agente/lib/minimizacao.ts` (atenção: `String.raw` é obrigatório; num template comum, `\b` viraria um caractere de retrocesso e as regras de OAB nunca casariam):

```ts
// O que identifica pessoa e não ajuda a análise (CPF, CNPJ, OAB) é tirado do
// texto ANTES de ele sair do agente — a minimização acontece na aba do eproc,
// não no servidor. Erra para o lado de tirar demais: um telefone de 11 dígitos
// vira [CPF], e tudo bem.
const UFS = 'AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO'

// A ordem importa: máscara antes de dígitos soltos, CNPJ (14) antes de CPF (11).
// O número de processo (20 dígitos, ou 7-2.4.1.2.4 com pontuação) não casa com
// nenhuma regra: os \b exigem que a sequência de dígitos termine ali.
// String.raw: num template comum, `\b` viraria um caractere de retrocesso.
const REGRAS: [RegExp, string][] = [
  [/\b[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}\b/g, '[CNPJ]'], // numérico ou alfanumérico
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[CPF]'],
  [/\b\d{14}\b/g, '[CNPJ]'],
  [/\b\d{11}\b/g, '[CPF]'],
  [new RegExp(String.raw`\bOAB\s*[/-]?\s*(?:${UFS})\s*(?:n[º°o.]*\s*)?[\d.]{3,9}[A-Z]?\b`, 'gi'), '[OAB]'], // OAB/SC 12.345
  [new RegExp(String.raw`\b(?:${UFS})\d{4,6}[A-Z]?\b`, 'g'), '[OAB]'], // RS012345, como aparece na tela
]

export function minimizar(texto: string): string {
  return REGRAS.reduce((t, [re, troca]) => t.replace(re, troca), texto)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/agente/lib/minimizacao.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` (limpo) e `npm run test:extensao` (tudo passa).

```bash
git add frontend/extensao/agente/lib/numero.ts frontend/extensao/agente/lib/minimizacao.ts frontend/extensao/agente/lib/minimizacao.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "extensao eproc: numero formatado do processo e minimizacao de CPF, CNPJ e OAB"
```

---

### Task 3: Contrato da B e pré-seleção de peças

**Files:**
- Create: `frontend/extensao/agente/lib/caso.ts`, `frontend/extensao/painel/caso/pecas.ts`
- Test: `frontend/extensao/painel/caso/pecas.test.ts`

**Interfaces:**
- Produces: `type Peca = { ref; tipo; rotulo; evento: number; data; sigiloso }`, `type Capa = { numero; classe; orgao; relator: string | null; assuntos: string[]; poloAtivo: string[]; poloPassivo: string[] }` (em `caso.ts`); `TIPOS`, `type Papel = 'decisao' | 'recurso' | 'inicial' | 'contestacao'`, `type Selecao = { papel: Papel; peca: Peca }`, `preselecionar(pecas: Peca[]): Selecao[]` (em `pecas.ts`).

- [ ] **Step 1: Criar o contrato e escrever os testes que falham**

`frontend/extensao/agente/lib/caso.ts` (só tipos; não há o que testar nele):

```ts
// Contrato entre o agente (que lê o eproc) e o painel (que monta o caso). As
// primitivas de rede da B vão PRODUZIR estes tipos a partir do HTML do TJSC;
// enquanto elas não existem, o resto da B trabalha só contra o contrato.

/** Uma peça (documento) na lista de eventos do processo. */
export type Peca = {
  ref: string // referência opaca; a URL assinada (doc, evento, key, hash) fica só no agente
  tipo: string // data-nome do eproc: 'SENT', 'DESPADEC', 'INIC'...
  rotulo: string // nome amigável, ex.: 'SENTENÇA 1'
  evento: number // número do evento; cresce com o tempo
  data: string // dd/mm/aaaa
  sigiloso: boolean // nível de sigilo do documento > 0 (ver lib/sigilo.ts)
}

/** A capa do processo, já sem CPF, CNPJ e OAB (ver lib/minimizacao.ts). */
export type Capa = {
  numero: string // 20 dígitos
  classe: string
  orgao: string
  relator: string | null
  assuntos: string[]
  poloAtivo: string[]
  poloPassivo: string[]
}
```

`frontend/extensao/painel/caso/pecas.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Peca } from '../../agente/lib/caso.ts'
import { preselecionar, TIPOS } from './pecas.ts'

const SENT = TIPOS.sentenca[0], DEC = TIPOS.decisao[0], REC = TIPOS.recurso[0], INIC = TIPOS.inicial[0], CONT = TIPOS.contestacao[0]
const p = (tipo: string, evento: number, extra: Partial<Peca> = {}): Peca => ({
  ref: `r${evento}`, tipo, rotulo: `${tipo} ${evento}`, evento, data: '01/01/2025', sigiloso: false, ...extra,
})
const resumo = (ps: Peca[]) => preselecionar(ps).map((s) => `${s.papel}:${s.peca.evento}`)

test('ordem de prioridade, não cronológica: decisão, recurso, inicial, contestação', () => {
  assert.deepEqual(resumo([p(INIC, 1), p(CONT, 5), p(SENT, 40), p(REC, 45)]),
    ['decisao:40', 'recurso:45', 'inicial:1', 'contestacao:5'])
})

test('várias sentenças: a de maior evento; sem sentença, a última decisão', () => {
  assert.deepEqual(resumo([p(SENT, 10), p(SENT, 30)]), ['decisao:30'])
  assert.deepEqual(resumo([p(DEC, 10), p(DEC, 22), p(INIC, 1)]), ['decisao:22', 'inicial:1'])
})

test('a sentença ganha da decisão, mesmo que a decisão seja mais recente', () => {
  assert.deepEqual(resumo([p(SENT, 10), p(DEC, 50)]), ['decisao:10'])
})

test('recurso anterior à decisão é ignorado; com vários, o mais recente', () => {
  assert.deepEqual(resumo([p(REC, 5), p(SENT, 40)]), ['decisao:40'])
  assert.deepEqual(resumo([p(SENT, 40), p(REC, 44), p(REC, 47)]), ['decisao:40', 'recurso:47'])
})

test('sem decisão, qualquer recurso vale (o mais recente)', () => {
  assert.deepEqual(resumo([p(REC, 3), p(REC, 9)]), ['recurso:9'])
})

test('petição inicial e contestação: a primeira de cada', () => {
  assert.deepEqual(resumo([p(INIC, 7), p(INIC, 2), p(CONT, 9), p(CONT, 4)]), ['inicial:2', 'contestacao:4'])
})

test('peça sigilosa nunca é selecionada; a próxima candidata a substitui', () => {
  assert.deepEqual(resumo([p(SENT, 40, { sigiloso: true }), p(DEC, 30)]), ['decisao:30'])
  assert.deepEqual(resumo([p(INIC, 1, { sigiloso: true })]), [])
})

test('lista vazia e tipos desconhecidos não selecionam nada', () => {
  assert.deepEqual(resumo([]), [])
  assert.deepEqual(resumo([p('ATOORD', 3), p('OUTRO', 4)]), [])
})

test('empate de número de evento é resolvido de forma estável (a primeira da lista)', () => {
  const a = p(SENT, 10, { ref: 'a' }), b = p(SENT, 10, { ref: 'b' })
  assert.equal(preselecionar([a, b])[0].peca.ref, 'a')
  assert.equal(preselecionar([b, a])[0].peca.ref, 'b')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/caso/pecas.test.ts`
Expected: FAIL, `Cannot find module ... pecas.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/painel/caso/pecas.ts`:

```ts
import type { Peca } from '../../agente/lib/caso.ts'

// Códigos de tipo de documento. Vistos no HAR da JFRS: SENT, DESPADEC, ATOORD
// (e INIC segundo o guia). APELACAO, AGRAVO e CONT são PALPITES — conferir no
// HAR do TJSC e ajustar SÓ aqui; os testes usam estas listas, não os literais.
export const TIPOS = {
  sentenca: ['SENT'],
  decisao: ['DESPADEC'],
  recurso: ['APELACAO', 'AGRAVO'],
  inicial: ['INIC'],
  contestacao: ['CONT'],
}

export type Papel = 'decisao' | 'recurso' | 'inicial' | 'contestacao'
export type Selecao = { papel: Papel; peca: Peca }

const ultima = (ps: Peca[]) => ps.reduce<Peca | undefined>((a, p) => (!a || p.evento > a.evento ? p : a), undefined)
const primeira = (ps: Peca[]) => ps.reduce<Peca | undefined>((a, p) => (!a || p.evento < a.evento ? p : a), undefined)

/**
 * Pré-marca as peças que a análise mais precisa, NA ORDEM DE PRIORIDADE (não
 * cronológica): decisão recorrida, recurso, petição inicial, contestação. A
 * ordem importa porque o pipeline lê só os primeiros `max_chars_caso`
 * caracteres do caso; se o texto passar do limite, o corte leva o que menos importa.
 * Peça sigilosa nunca é selecionada.
 */
export function preselecionar(pecas: Peca[]): Selecao[] {
  const publicas = pecas.filter((p) => !p.sigiloso)
  const de = (tipos: string[]) => publicas.filter((p) => tipos.includes(p.tipo))

  const decisao = ultima(de(TIPOS.sentenca)) ?? ultima(de(TIPOS.decisao))
  const recursos = de(TIPOS.recurso).filter((p) => !decisao || p.evento > decisao.evento)
  const alvos: [Papel, Peca | undefined][] = [
    ['decisao', decisao],
    ['recurso', ultima(recursos)],
    ['inicial', primeira(de(TIPOS.inicial))],
    ['contestacao', primeira(de(TIPOS.contestacao))],
  ]
  return alvos.flatMap(([papel, peca]) => (peca ? [{ papel, peca }] : []))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/caso/pecas.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/agente/lib/caso.ts frontend/extensao/painel/caso/pecas.ts frontend/extensao/painel/caso/pecas.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "extensao eproc: contrato da capa e das pecas e pre-selecao por prioridade"
```

---

### Task 4: Montagem do texto do caso

**Files:**
- Create: `frontend/extensao/painel/caso/montagem.ts`
- Test: `frontend/extensao/painel/caso/montagem.test.ts`

**Interfaces:**
- Consumes: `Capa`, `Peca` (Task 3, `agente/lib/caso.ts`); `Papel` (Task 3, `painel/caso/pecas.ts`); `formatarNumeroProcesso` (Task 2).
- Produces: `type Item = { papel: Papel; peca: Peca; texto: string }`, `type Montagem = { texto; chars; limite; excede: boolean; cortadas: string[] }`, `montarCaso(capa: Capa, itens: Item[], limite: number): Montagem` (lança `RangeError` se `limite` não for um número finito > 0).

- [ ] **Step 1: Escrever os testes que falham**

`frontend/extensao/painel/caso/montagem.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Capa, Peca } from '../../agente/lib/caso.ts'
import { montarCaso, type Item } from './montagem.ts'

const CAPA: Capa = {
  numero: '50012345620208240023', classe: 'APELAÇÃO CÍVEL', orgao: '6ª Câmara de Direito Comercial',
  relator: 'RUBENS SCHULZ', assuntos: ['PIS', 'Contribuições Sociais'],
  poloAtivo: ['EMPRESA EXEMPLO LTDA'], poloPassivo: ['UNIÃO - FAZENDA NACIONAL'],
}
const peca = (rotulo: string, evento: number): Peca =>
  ({ ref: 'r', tipo: 'X', rotulo, evento, data: '10/03/2025', sigiloso: false })
const item = (papel: Item['papel'], rotulo: string, evento: number, texto: string): Item =>
  ({ papel, peca: peca(rotulo, evento), texto })

test('cabeçalho e blocos, na ordem recebida, com evento e data', () => {
  const m = montarCaso(CAPA, [item('decisao', 'SENTENÇA 1', 45, 'julgo improcedente'), item('inicial', 'INICIAL 1', 1, 'pede a reforma')], 20000)
  assert.equal(m.texto, [
    'PROCESSO 5001234-56.2020.8.24.0023 — APELAÇÃO CÍVEL — 6ª Câmara de Direito Comercial',
    'Relator: RUBENS SCHULZ',
    'Assuntos: PIS; Contribuições Sociais',
    'Polo ativo: EMPRESA EXEMPLO LTDA',
    'Polo passivo: UNIÃO - FAZENDA NACIONAL',
    '',
    '=== DECISÃO RECORRIDA — SENTENÇA 1 (evento 45, 10/03/2025) ===',
    'julgo improcedente',
    '',
    '=== PETIÇÃO INICIAL — INICIAL 1 (evento 1, 10/03/2025) ===',
    'pede a reforma',
  ].join('\n'))
  assert.equal(m.chars, m.texto.length)
  assert.equal(m.excede, false)
  assert.deepEqual(m.cortadas, [])
})

test('sem relator nem assuntos, as linhas somem; polo vazio vira travessão', () => {
  const m = montarCaso({ ...CAPA, relator: null, assuntos: [], poloPassivo: [] }, [], 20000)
  assert.ok(!m.texto.includes('Relator:'))
  assert.ok(!m.texto.includes('Assuntos:'))
  assert.ok(m.texto.endsWith('Polo passivo: —'))
})

test('limite: quem termina depois dele é listado como cortado, na ordem', () => {
  const grande = 'x'.repeat(500)
  const itens = [item('decisao', 'SENTENÇA 1', 45, grande), item('recurso', 'APELAÇÃO 1', 50, grande), item('inicial', 'INICIAL 1', 1, grande)]
  const m = montarCaso(CAPA, itens, 800)
  assert.equal(m.excede, true)
  assert.equal(m.limite, 800)
  assert.deepEqual(m.cortadas, ['RECURSO — APELAÇÃO 1', 'PETIÇÃO INICIAL — INICIAL 1'])
})

test('exatamente no limite não excede', () => {
  const base = montarCaso(CAPA, [item('decisao', 'S', 1, 'abc')], 20000)
  const m = montarCaso(CAPA, [item('decisao', 'S', 1, 'abc')], base.chars)
  assert.equal(m.excede, false)
  assert.deepEqual(m.cortadas, [])
})

test('espaços nas pontas do texto da peça são aparados', () => {
  const m = montarCaso(CAPA, [item('decisao', 'S', 1, '  \n texto \n ')], 20000)
  assert.ok(m.texto.endsWith('===\ntexto'))
})

test('limite inválido (NaN, zero, negativo, indefinido, infinito) falha em vez de esconder o aviso de corte', () => {
  for (const l of [NaN, 0, -1, undefined as unknown as number, Infinity]) {
    assert.throws(() => montarCaso(CAPA, [], l), RangeError, String(l))
  }
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/caso/montagem.test.ts`
Expected: FAIL, `Cannot find module ... montagem.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/painel/caso/montagem.ts`:

```ts
import type { Capa, Peca } from '../../agente/lib/caso.ts'
import { formatarNumeroProcesso } from '../../agente/lib/numero.ts'
import type { Papel } from './pecas.ts'

const ROTULO: Record<Papel, string> = {
  decisao: 'DECISÃO RECORRIDA',
  recurso: 'RECURSO',
  inicial: 'PETIÇÃO INICIAL',
  contestacao: 'CONTESTAÇÃO',
}

export type Item = { papel: Papel; peca: Peca; texto: string }
export type Montagem = {
  texto: string
  chars: number
  limite: number
  excede: boolean
  /** Peças que terminam depois do limite: parte delas (ou todas) ficará de fora da leitura. */
  cortadas: string[]
}

/**
 * Monta o texto do caso: cabeçalho da capa e, em ordem, cada peça. `limite` é o
 * `max_chars_caso` do servidor (GET /api/config → busca.max_chars_caso): o
 * pipeline lê só os primeiros `limite` caracteres, então o painel avisa quem
 * fica de fora em vez de deixar o sistema "não enfrentar" um pedido em silêncio.
 * Os textos já chegam minimizados pelo agente (lib/minimizacao.ts).
 */
export function montarCaso(capa: Capa, itens: Item[], limite: number): Montagem {
  // limite indefinido (NaN) faria `excede` ser sempre false, e o aviso de corte sumiria calado
  if (!Number.isFinite(limite) || limite <= 0) throw new RangeError('limite do caso inválido: ' + limite)
  const polo = (nomes: string[]) => nomes.join('; ') || '—'
  const cabecalho = [
    `PROCESSO ${formatarNumeroProcesso(capa.numero)} — ${capa.classe} — ${capa.orgao}`,
    ...(capa.relator ? [`Relator: ${capa.relator}`] : []),
    ...(capa.assuntos.length ? [`Assuntos: ${capa.assuntos.join('; ')}`] : []),
    `Polo ativo: ${polo(capa.poloAtivo)}`,
    `Polo passivo: ${polo(capa.poloPassivo)}`,
  ].join('\n')

  let texto = cabecalho
  const cortadas: string[] = []
  for (const { papel, peca, texto: corpo } of itens) {
    texto += `\n\n=== ${ROTULO[papel]} — ${peca.rotulo} (evento ${peca.evento}, ${peca.data}) ===\n${corpo.trim()}`
    if (texto.length > limite) cortadas.push(`${ROTULO[papel]} — ${peca.rotulo}`)
  }
  return { texto, chars: texto.length, limite, excede: texto.length > limite, cortadas }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/caso/montagem.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/painel/caso/montagem.ts frontend/extensao/painel/caso/montagem.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "extensao eproc: montagem do texto do caso com aviso de corte"
```

---

### Task 5: Relator do processo → cérebro

**Files:**
- Create: `frontend/extensao/painel/caso/relator.ts`
- Test: `frontend/extensao/painel/caso/relator.test.ts`

**Interfaces:**
- Produces: `normalizarNome(nome: string): string`; `cerebroDoRelator(relator: string | null, cerebros: { slug: string; nome: string }[]): string | null`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/extensao/painel/caso/relator.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cerebroDoRelator, normalizarNome } from './relator.ts'

const CEREBROS = [
  { slug: 'rubens-schulz', nome: 'Rubens Schulz' },
  { slug: 'andre-luiz-dacol', nome: 'André Luiz Dacol' },
]

test('normalizar: sem acento, sem caixa, sem título, espaços colapsados', () => {
  assert.equal(normalizarNome('  Desembargador   ANDRÉ  Luiz Dacol '), 'andre luiz dacol')
  assert.equal(normalizarNome('DES. Rubens Schulz'), 'rubens schulz')
  assert.equal(normalizarNome('Juíza Federal Maria Souza'), 'maria souza')
})

test('relator com cérebro: casa mesmo com caixa, acento e título diferentes', () => {
  assert.equal(cerebroDoRelator('RUBENS SCHULZ', CEREBROS), 'rubens-schulz')
  assert.equal(cerebroDoRelator('Desembargador André Luiz Dacol', CEREBROS), 'andre-luiz-dacol')
  assert.equal(cerebroDoRelator('ANDRE LUIZ DACOL', CEREBROS), 'andre-luiz-dacol')
})

test('relator sem cérebro, ausente ou vazio: null', () => {
  assert.equal(cerebroDoRelator('EVANDRO UBIRATAN PAIVA DA SILVEIRA', CEREBROS), null)
  assert.equal(cerebroDoRelator(null, CEREBROS), null)
  assert.equal(cerebroDoRelator('   ', CEREBROS), null)
  assert.equal(cerebroDoRelator('Rubens Schulz', []), null)
})

test('nada de parecido: nome parcial ou com sobrenome a mais não casa', () => {
  assert.equal(cerebroDoRelator('Rubens', CEREBROS), null)
  assert.equal(cerebroDoRelator('Rubens Schulz Filho', CEREBROS), null)
})

test('dois cérebros com o mesmo nome normalizado: ambíguo, null', () => {
  const dup = [...CEREBROS, { slug: 'rubens-schulz-2', nome: 'RUBENS SCHULZ' }]
  assert.equal(cerebroDoRelator('Rubens Schulz', dup), null)
})

test('relator que é só um título não casa com ninguém', () => {
  assert.equal(cerebroDoRelator('Desembargador', CEREBROS), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/caso/relator.test.ts`
Expected: FAIL, `Cannot find module ... relator.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/painel/caso/relator.ts`:

```ts
// Nome de pessoa sem acento, sem caixa, sem título e com espaço normalizado. Só
// serve para COMPARAR; nunca para exibir.
const TITULO = /^(desembargador(a)?|des\.?|ju[ií]z(a)?( federal)?|dr\.?|dra\.?)\s+/i

export function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ') // antes do título: o ^ do TITULO precisa do começo limpo
    .trim()
    .replace(TITULO, '')
    .toLowerCase()
}

/**
 * Qual cérebro (acervo de um desembargador) corresponde ao relator do processo.
 * Igualdade EXATA do nome normalizado, e nada de "parecido": escolher o acervo
 * errado é o único erro daqui que ninguém percebe olhando a tela. Sem
 * correspondência devolve null, e o painel avisa em vez de escolher.
 */
export function cerebroDoRelator(relator: string | null, cerebros: { slug: string; nome: string }[]): string | null {
  if (!relator) return null
  const alvo = normalizarNome(relator)
  if (!alvo) return null
  const achados = cerebros.filter((c) => normalizarNome(c.nome) === alvo)
  return achados.length === 1 ? achados[0].slug : null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/caso/relator.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/painel/caso/relator.ts frontend/extensao/painel/caso/relator.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "extensao eproc: relator do processo casa com o cerebro so por nome exato"
```

---

### Task 6: Validação e máscara de CPF/CNPJ

**Files:**
- Create: `frontend/extensao/agente/lib/documento.ts`
- Test: `frontend/extensao/agente/lib/documento.test.ts`

**Interfaces:**
- Produces: `type TipoDocumento = 'cpf' | 'cnpj'`; `normalizar(v: string): string`; `cpfValido(d: string): boolean` e `cnpjValido(d: string): boolean` (recebem o documento já normalizado); `tipoDoDocumento(v: string): TipoDocumento | null`; `mascarar(v: string): string | null`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/extensao/agente/lib/documento.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cnpjValido, cpfValido, mascarar, normalizar, tipoDoDocumento } from './documento.ts'

test('normalizar: sem máscara, maiúsculas', () => {
  assert.equal(normalizar('11.222.333/0001-81'), '11222333000181')
  assert.equal(normalizar('12.abc.345/01de-35'), '12ABC34501DE35')
  assert.equal(normalizar(undefined as unknown as string), '')
})

test('CPF: válido, dígito errado, repetido, tamanho e letras', () => {
  assert.equal(cpfValido('52998224725'), true)
  assert.equal(cpfValido('52998224726'), false)
  assert.equal(cpfValido('11111111111'), false)
  assert.equal(cpfValido('5299822472'), false)
  assert.equal(cpfValido('5299822472A'), false)
})

test('CNPJ numérico e alfanumérico (o exemplo divulgado pela Receita)', () => {
  assert.equal(cnpjValido('11222333000181'), true)
  assert.equal(cnpjValido('11222333000182'), false)
  assert.equal(cnpjValido('12ABC34501DE35'), true)
  assert.equal(cnpjValido('12ABC34501DE36'), false)
  assert.equal(cnpjValido('00000000000000'), false)
  assert.equal(cnpjValido('12ABC34501DEAB'), false) // os dois últimos são dígitos
})

test('tipoDoDocumento: aceita máscara, minúsculas e diz qual é', () => {
  assert.equal(tipoDoDocumento('529.982.247-25'), 'cpf')
  assert.equal(tipoDoDocumento('11.222.333/0001-81'), 'cnpj')
  assert.equal(tipoDoDocumento('12.abc.345/01de-35'), 'cnpj')
  assert.equal(tipoDoDocumento('529.982.247-26'), null)
  assert.equal(tipoDoDocumento(''), null)
  assert.equal(tipoDoDocumento('ABCDEFGHIJK'), null)
})

test('mascarar: a máscara de cada tipo; inválido é null', () => {
  assert.equal(mascarar('52998224725'), '529.982.247-25')
  assert.equal(mascarar('529.982.247-25'), '529.982.247-25')
  assert.equal(mascarar('11222333000181'), '11.222.333/0001-81')
  assert.equal(mascarar('12abc34501de35'), '12.ABC.345/01DE-35')
  assert.equal(mascarar('52998224726'), null)
  assert.equal(mascarar('123'), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/agente/lib/documento.test.ts`
Expected: FAIL, `Cannot find module ... documento.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/agente/lib/documento.ts`:

```ts
// CPF e CNPJ (inclusive o CNPJ alfanumérico, em vigor desde julho de 2026).
// Valide ANTES de consultar o eproc: documento com dígito errado volta como
// "nenhum processo", que parece uma resposta legítima.

export type TipoDocumento = 'cpf' | 'cnpj'

/** Só letras e dígitos, em maiúsculas: o que sobra depois de tirar a máscara. */
export const normalizar = (v: string) => String(v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()

/** `d` já normalizado. */
export function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const dv = (base: string) => {
    let s = 0
    for (let i = 0; i < base.length; i++) s += Number(base[i]) * (base.length + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(d.slice(0, 9)) === Number(d[9]) && dv(d.slice(0, 10)) === Number(d[10])
}

/** `d` já normalizado. Cada caractere vale o código ASCII menos 48 (A = 17, B = 18...). */
export function cnpjValido(d: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let s = 0
    for (let i = 0; i < base.length; i++) s += (base.charCodeAt(i) - 48) * pesos[i]
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

/** 'cpf', 'cnpj' ou null quando não é um documento válido (com ou sem máscara). */
export function tipoDoDocumento(v: string): TipoDocumento | null {
  const d = normalizar(v)
  if (cpfValido(d)) return 'cpf'
  if (cnpjValido(d)) return 'cnpj'
  return null
}

/**
 * O documento com a máscara que o campo de busca do eproc usa (a página envia o
 * valor mascarado; reproduzimos). null se não for um documento válido.
 */
export function mascarar(v: string): string | null {
  const d = normalizar(v)
  switch (tipoDoDocumento(v)) {
    case 'cpf':
      return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    case 'cnpj':
      return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    default:
      return null
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/agente/lib/documento.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/agente/lib/documento.ts frontend/extensao/agente/lib/documento.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "extensao eproc: validacao e mascara de CPF e CNPJ, inclusive alfanumerico"
```

---

### Task 7: Corpo da busca e leitura da resposta

**Files:**
- Create: `frontend/extensao/agente/lib/busca.ts`
- Test: `frontend/extensao/agente/lib/busca.test.ts`

**Interfaces:**
- Consumes: `ErroEproc` (`agente/lib/erros.ts`, já existe); `separar` (`agente/lib/sigilo.ts`, já existe: separa públicos de sigilosos e trata item nulo como sigiloso).
- Produces: `type Par = [string, string]`; `CORPO_CAPTCHA: Par[]`; `corpoDaBusca(documentoMascarado: string): Par[]`; `textoSemHtml(v: unknown): string`; `partesDoCampo(v: unknown): string[]`; `linkDoProcesso(linkAssinado: string): string`; `type ProcessoDaLista`; `type ResultadoBusca = { processos; sigilosos; total; possivelCorte }`; `TETO_OBSERVADO = 30`; `lerBusca(resposta: unknown): ResultadoBusca` (lança `ErroEproc('LAYOUT')` quando `resultados` não é uma lista ou um resultado público vem sem número de 20 dígitos ou sem link).

- [ ] **Step 1: Escrever os testes que falham**

`frontend/extensao/agente/lib/busca.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CORPO_CAPTCHA, corpoDaBusca, lerBusca, linkDoProcesso, partesDoCampo, textoSemHtml } from './busca.ts'
import { ErroEproc } from './erros.ts'

// Fixture FICTÍCIA, no formato do HAR da JFRS. Nada aqui é de processo real.
const LINK = 'controlador.php?acao=processo_selecionar&acao_origem=pesquisa_processo_doc_parte&acao_retorno=pesquisa_processo_doc_parte#_processo=50012345620208240023&hash=abc123'
const item = (extra: Record<string, unknown> = {}) => ({
  nr_processo: '50012345620208240023', autuacao: '20/05/2020 11:01:05', str_sig_orgao_juizo: 'RSPOA14S',
  linkProcessoAssinado: LINK, autor: 'S&amp;P EMPRESA EXEMPLO LTDA.<br>', reu: 'UNIÃO - FAZENDA NACIONAL<br>e outros',
  classe: 'MANDADO DE SEGURANÇA', ultimo_evento: '16/03/2022 14:13:37 - Baixa Definitiva',
  id_sigilo: '0', des_assuntos: 'PIS, Contribuições Sociais', des_situacao: 'BAIXADO', ...extra,
})
const eLayout = (e: unknown) => e instanceof ErroEproc && e.tipo === 'LAYOUT'

test('corpo da busca: 13 campos na ordem da página, fnValidacao[] repetido, documento mascarado', () => {
  const c = corpoDaBusca('11.222.333/0001-81')
  assert.equal(c.length, 13)
  assert.deepEqual(c.filter(([k]) => k === 'fnValidacao[]').map(([, v]) => v), ['gerenciadorTelaConsulta', 'executarValidacoes'])
  assert.deepEqual(c.find(([k]) => k === 'strDocParte'), ['strDocParte', '11.222.333/0001-81'])
  assert.deepEqual(c.find(([k]) => k === 'tipoPesquisa'), ['tipoPesquisa', 'CP'])
  assert.deepEqual(c.find(([k]) => k === 'chkExibirBaixados'), ['chkExibirBaixados', 'on'])
  for (const vazio of ['acao_retorno', 'numNrProcesso', 'selIdClasseSelecionados', 'strChave']) {
    assert.deepEqual(c.find(([k]) => k === vazio), [vazio, ''])
  }
  assert.equal(CORPO_CAPTCHA.length, 3)
})

test('textoSemHtml e partesDoCampo: <br>, entidades e "e outros"', () => {
  assert.equal(textoSemHtml('S&amp;P<br>LTDA &lt;x&gt;'), 'S&P LTDA <x>')
  assert.equal(textoSemHtml('&amp;lt;'), '&lt;') // não decodifica duas vezes
  assert.deepEqual(partesDoCampo('A<br>B<br>e outros'), ['A', 'B'])
  assert.deepEqual(partesDoCampo('A<BR/>B'), ['A', 'B'])
  assert.deepEqual(partesDoCampo(null), [])
  assert.equal(textoSemHtml('<script>x</script>oi'), 'xoi') // tira a tag; nunca vai para innerHTML
})

test('link: o fragmento vira num_processo e hash na query', () => {
  assert.equal(linkDoProcesso(LINK),
    'controlador.php?acao=processo_selecionar&acao_origem=pesquisa_processo_doc_parte&acao_retorno=pesquisa_processo_doc_parte&num_processo=50012345620208240023&hash=abc123')
  assert.equal(linkDoProcesso('controlador.php?acao=x&hash=h'), 'controlador.php?acao=x&hash=h')
  assert.throws(() => linkDoProcesso('controlador.php?acao=x#_processo=1'), eLayout)
  assert.throws(() => linkDoProcesso('controlador.php?acao=x#hash=h'), eLayout)
})

test('lista pública: campos limpos, partes separadas, link reconstruído', () => {
  const r = lerBusca({ resultados: [item()] })
  assert.equal(r.total, 1)
  assert.equal(r.sigilosos, 0)
  assert.equal(r.possivelCorte, false)
  assert.deepEqual(r.processos[0], {
    numero: '50012345620208240023', autuacao: '20/05/2020 11:01:05', juizo: 'RSPOA14S',
    classe: 'MANDADO DE SEGURANÇA', ultimoEvento: '16/03/2022 14:13:37 - Baixa Definitiva',
    situacao: 'BAIXADO', assuntos: 'PIS, Contribuições Sociais',
    autores: ['S&P EMPRESA EXEMPLO LTDA.'], reus: ['UNIÃO - FAZENDA NACIONAL'],
    link: linkDoProcesso(LINK),
  })
})

test('sigilosos só contados, e nunca aparecem na lista', () => {
  const r = lerBusca({ resultados: [item(), item({ nr_processo: '50099999920208240023', id_sigilo: '1' }), item({ id_sigilo: undefined })] })
  assert.equal(r.processos.length, 1)
  assert.equal(r.sigilosos, 2)
  assert.equal(r.total, 3)
  assert.ok(!JSON.stringify(r).includes('50099999920208240023'))
})

test('só sigilosos: lista vazia mas com contagem (a tela não pode dizer "nenhum processo")', () => {
  const r = lerBusca({ resultados: [item({ id_sigilo: '2' })] })
  assert.deepEqual([r.processos.length, r.sigilosos, r.total], [0, 1, 1])
})

test('lista vazia é resposta; resultados ausente ou de outro tipo é LAYOUT', () => {
  assert.deepEqual(lerBusca({ resultados: [] }), { processos: [], sigilosos: 0, total: 0, possivelCorte: false })
  for (const r of [{}, null, undefined, 'x', { resultados: 'x' }, { resultados: {} }]) {
    assert.throws(() => lerBusca(r), eLayout, JSON.stringify(r))
  }
})

test('resultado público sem número válido ou sem link é LAYOUT', () => {
  assert.throws(() => lerBusca({ resultados: [item({ nr_processo: '123' })] }), eLayout)
  assert.throws(() => lerBusca({ resultados: [item({ nr_processo: undefined })] }), eLayout)
  assert.throws(() => lerBusca({ resultados: [item({ linkProcessoAssinado: undefined })] }), eLayout)
})

test('30 resultados (o máximo visto) avisa que a lista pode estar incompleta', () => {
  assert.equal(lerBusca({ resultados: Array.from({ length: 30 }, () => item()) }).possivelCorte, true)
  assert.equal(lerBusca({ resultados: Array.from({ length: 29 }, () => item()) }).possivelCorte, false)
})

test('item nulo ou não-objeto na lista conta como sigiloso: fail closed, sem exceção crua', () => {
  const r = lerBusca({ resultados: [null, item(), 'x'] })
  assert.equal(r.processos.length, 1)
  assert.equal(r.sigilosos, 2)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/agente/lib/busca.test.ts`
Expected: FAIL, `Cannot find module ... busca.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/agente/lib/busca.ts`:

```ts
// Busca por documento da parte (CPF/CNPJ): monta o corpo do POST e lê a resposta.
// Formatos vistos no HAR da JFRS (25/09/2026); conferir contra o TJSC quando o
// HAR de lá chegar. Nada aqui faz requisição: a rede é do `rede.ts`.
import { ErroEproc } from './erros.ts'
import { separar } from './sigilo.ts'

export type Par = [string, string]

/** Corpo da verificação de captcha que o eproc faz antes de buscar. */
export const CORPO_CAPTCHA: Par[] = [
  ['strIdForm', 'frmProcessoListaAjax'],
  ['fnValidacao[]', 'gerenciadorTelaConsulta'],
  ['fnValidacao[]', 'executarValidacoes'],
]

/**
 * Os 13 campos do POST, na ordem da página. `fnValidacao[]` aparece duas vezes
 * (por isso lista de pares, e não objeto) e os vazios vão vazios. O documento
 * vai MASCARADO, como o campo da página o envia (ver lib/documento.ts).
 */
export function corpoDaBusca(documentoMascarado: string): Par[] {
  return [
    ['hdnInfraTipoPagina', '1'],
    ['strIdForm', 'frmProcessoListaAjax'],
    ['fnValidacao[]', 'gerenciadorTelaConsulta'],
    ['fnValidacao[]', 'executarValidacoes'],
    ['acao_origem', 'consultar'],
    ['acao_retorno', ''],
    ['acao', 'pesquisa_processo_doc_parte'],
    ['tipoPesquisa', 'CP'],
    ['numNrProcesso', ''],
    ['strDocParte', documentoMascarado],
    ['selIdClasseSelecionados', ''],
    ['strChave', ''],
    ['chkExibirBaixados', 'on'],
  ]
}

/** `autor` e `reu` vêm como HTML: nunca vão para innerHTML, sempre por aqui. */
export function textoSemHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&') // por último, para não decodificar duas vezes
    .replace(/\s+/g, ' ')
    .trim()
}

/** "A<br>B<br>e outros" vira ["A", "B"]. */
export function partesDoCampo(v: unknown): string[] {
  return String(v ?? '')
    .split(/<br\s*\/?>/i)
    .map(textoSemHtml)
    .filter((p) => p && !/^e outros$/i.test(p))
}

/**
 * O link do resultado vem com `#_processo=<n>&hash=<h>` depois de um `#`; o
 * navegador da própria página o transforma em `num_processo=<n>&hash=<h>` na
 * query. Reconstruímos isso. Sem `#`, o link já está pronto.
 */
export function linkDoProcesso(linkAssinado: string): string {
  const i = linkAssinado.indexOf('#')
  if (i < 0) return linkAssinado
  const frag = new URLSearchParams(linkAssinado.slice(i + 1))
  const numero = frag.get('_processo')
  const hash = frag.get('hash')
  if (!numero || !hash) throw new ErroEproc('LAYOUT', 'link do processo sem número ou hash')
  const params = new URLSearchParams({ num_processo: numero, hash })
  return `${linkAssinado.slice(0, i)}&${params.toString()}`
}

export type ProcessoDaLista = {
  numero: string // 20 dígitos; formatar só na hora de exibir (lib/numero.ts)
  autuacao: string
  juizo: string
  classe: string
  ultimoEvento: string
  situacao: string
  assuntos: string
  autores: string[]
  reus: string[]
  link: string // relativo à página, pronto para abrir em aba nova
}
export type ResultadoBusca = {
  processos: ProcessoDaLista[] // só os públicos
  sigilosos: number // só a contagem; o conteúdo nunca sai
  total: number // o que o eproc devolveu, sigilosos incluídos
  possivelCorte: boolean // 30 é o máximo visto na JFRS: a lista pode estar incompleta
}

export const TETO_OBSERVADO = 30
const texto = (v: unknown) => textoSemHtml(v)

/**
 * `resultados` ausente é ERRO DE LAYOUT, nunca "nenhum processo": um falso
 * "nunca litigou" é o pior erro possível aqui. Lista vazia é uma resposta.
 */
export function lerBusca(resposta: unknown): ResultadoBusca {
  const lista = (resposta as { resultados?: unknown } | null)?.resultados
  if (!Array.isArray(lista)) throw new ErroEproc('LAYOUT', 'resposta da busca sem resultados')
  const { publicos, sigilosos } = separar(lista as { id_sigilo?: unknown }[])
  const processos = publicos.map((p) => {
    const r = p as Record<string, unknown>
    if (typeof r.nr_processo !== 'string' || !/^\d{20}$/.test(r.nr_processo)) {
      throw new ErroEproc('LAYOUT', 'resultado sem número de processo válido')
    }
    if (typeof r.linkProcessoAssinado !== 'string') throw new ErroEproc('LAYOUT', 'resultado sem link do processo')
    return {
      numero: r.nr_processo,
      autuacao: texto(r.autuacao),
      juizo: texto(r.str_sig_orgao_juizo),
      classe: texto(r.classe),
      ultimoEvento: texto(r.ultimo_evento),
      situacao: texto(r.des_situacao),
      assuntos: texto(r.des_assuntos),
      autores: partesDoCampo(r.autor),
      reus: partesDoCampo(r.reu),
      link: linkDoProcesso(r.linkProcessoAssinado),
    }
  })
  return { processos, sigilosos, total: lista.length, possivelCorte: lista.length >= TETO_OBSERVADO }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/agente/lib/busca.test.ts`
Expected: PASS, 10 testes.

- [ ] **Step 5: Verificação final e commit**

Run: `npx tsc --noEmit` (limpo) e `npm run test:extensao` (tudo passa; o total sobe em 44 testes em relação ao início do plano).

Run (na raiz): `cmd /c ".\verificar.bat"`
Expected: termina com `TUDO OK`.

```bash
git add frontend/extensao/agente/lib/busca.ts frontend/extensao/agente/lib/busca.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "extensao eproc: corpo da busca por documento e leitura da resposta com sigilo"
```
