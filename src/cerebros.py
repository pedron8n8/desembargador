"""Quem julga o caso: um cerebro = um acervo + uma persona + seus artefatos.

Ate' a fase 7 o sistema era mono-relator POR CONSTRUCAO. Nao era so' o nome no
prompt: os caminhos eram constantes de modulo (output/rag.db, output/floresta.pkl),
e a tabela `decisao` do indice nem coluna de relator tem. Este modulo e' a unica
fonte da verdade sobre "de quem e' este acervo e onde ele mora".

O Rubens FICA ONDE ESTA' ("dir": "output"). Mover 1,4 GB de tjsc.db nao compra
nada e e' risco puro; um campo no JSON custa zero e deixa um caminho de codigo
so'. Cerebro novo nasce em output/cerebros/<slug>/.

Cuidado com o nome: `estado["perfil"]` JA' EXISTE no grafo e significa outra
coisa (o perfil estatistico dos precedentes, de sinais.perfil). O conceito daqui
chama-se `cerebro` em todo lugar — modulo, JSON, campo do Estado, coluna de
banco, query param. Nunca "perfil", nunca "relator" (o Dacol e' relator; um
lider publico nao seria).

    python -m src.cerebros                    # lista o que ha', com saude
    python -m src.cerebros --ativar SLUG
    python -m src.cerebros --desativar SLUG
"""
import json
import os
import sqlite3
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQUIVO = os.path.join(RAIZ, "cerebros.json")

# O slug que TODO dado anterior a' multiplicidade tem, por definicao. Usado so'
# no backfill das migracoes (api/esquema.py, src/rag/feedback.py). NAO use
# padrao() para isso: o padrao pode mudar amanha e reescreveria a historia.
CEREBRO_LEGADO = "rubens-schulz"

# Defaults de quem nao declarar. Ficam aqui e nao no JSON para o arquivo do
# usuario poder ser curto. Os dicts sao recriados a cada _completar() de
# proposito: um default mutavel compartilhado seria escrito por engano um dia.
def _padroes():
    return {"titulo": "Desembargador", "tribunal": "TJSC", "ativo": 1,
            "coleta": {}, "modelo": {}, "esperado": {}}


class Desconhecido(ValueError):
    """Slug que nao existe no cerebros.json."""


_cache = {"mtime": None, "dados": None}


def _sintetico():
    """Sem cerebros.json, o mundo e' o de antes desta fase: um cerebro so', nos
    caminhos antigos. E' o que mantem verdes os ~20 self-checks offline e o
    api/smoke.py em qualquer checkout que ainda nao tenha o arquivo."""
    return {"padrao": CEREBRO_LEGADO,
            "cerebros": [{"slug": CEREBRO_LEGADO, "nome": "Rubens Schulz",
                          "dir": "output"}]}


def _carregar():
    """Cache invalidado por mtime, NAO permanente.

    llm.config() cacheia para sempre e a docstring de /api/config ja' reconhece
    que isso faz o painel mentir ate' alguem reiniciar. Aqui seria pior: o
    superadmin ativa um cerebro e o servidor continuaria escondendo-o.
    """
    try:
        mtime = os.path.getmtime(ARQUIVO)
    except OSError:
        return _sintetico()
    if _cache["mtime"] != mtime:
        with open(ARQUIVO, encoding="utf-8") as f:
            _cache["dados"] = json.load(f)
        _cache["mtime"] = mtime
    return _cache["dados"]


def _completar(c):
    d = _padroes()
    d.update(c)
    d["ativo"] = int(bool(d.get("ativo", 1)))
    d["dir"] = os.path.join(RAIZ, d.get("dir") or os.path.join("output", "cerebros",
                                                               d["slug"]))
    return d


def listar(incluir_inativos=False):
    """Na ordem do arquivo, com `dir` ja' absoluto."""
    todos = [_completar(c) for c in _carregar().get("cerebros", [])]
    return todos if incluir_inativos else [c for c in todos if c["ativo"]]


def obter(slug):
    for c in listar(incluir_inativos=True):
        if c["slug"] == slug:
            return c
    raise Desconhecido("cérebro desconhecido: %r (há: %s)"
                       % (slug, ", ".join(c["slug"] for c in
                                          listar(incluir_inativos=True))))


def padrao():
    """O do campo `padrao`; se ele apontar para nada, o primeiro ativo."""
    p = _carregar().get("padrao")
    todos = listar(incluir_inativos=True)
    if p and any(c["slug"] == p for c in todos):
        return p
    ativos = [c for c in todos if c["ativo"]]
    if not ativos:
        raise Desconhecido("nenhum cérebro ativo em %s" % ARQUIVO)
    return ativos[0]["slug"]


def resolver(slug=None):
    """None/"" -> padrao(). Valida sempre — slug invalido levanta, nao cai no
    padrao calado: responder com o acervo errado e' o unico erro daqui que
    ninguem detecta."""
    if not slug:
        return padrao()
    return obter(slug)["slug"]


def caminhos(slug=None):
    """Onde moram os artefatos deste cerebro. Todos absolutos. None -> padrao().

    E' a funcao que o resto do sistema chama. Quem receber um destes caminhos
    NUNCA deve completa-lo com uma constante de modulo — e' assim que o acervo
    de um cerebro vaza na consulta de outro, com resultado plausivel e zero erro.
    """
    c = obter(resolver(slug))
    d = c["dir"]
    return {"slug": c["slug"], "nome": c["nome"], "dir": d,
            "titulo": c["titulo"], "tribunal": c["tribunal"],
            "tjsc": os.path.join(d, "tjsc.db"),
            "rag": os.path.join(d, "rag.db"),
            "floresta": os.path.join(d, "floresta.pkl"),
            "calibrador": os.path.join(d, "calibrador.pkl"),
            "documentos": os.path.join(d, "documentos"),
            "exports": os.path.join(d, "exports"),
            "logs": os.path.join(d, "logs")}


def saude(slug):
    """O que existe em disco e quanta base historica ha'.

    `n_merito` e' o que decide se o progn'ostico deste cerebro pode cravar
    (src/rag/grafo.py) e se vale treinar a floresta. Acervo pequeno nao e'
    defeito — mentir sobre ele e' que seria.
    """
    cam = caminhos(slug)
    n = merito = 0
    try:
        db = sqlite3.connect("file:%s?mode=ro" % cam["rag"].replace("\\", "/"),
                             uri=True)
        try:
            n, = db.execute("SELECT count(*) FROM decisao").fetchone()
            merito, = db.execute(
                "SELECT count(*) FROM decisao WHERE resultado IN "
                "('provido','parcialmente provido','desprovido')").fetchone()
        finally:
            db.close()
    except (OSError, sqlite3.Error):
        pass
    return {"slug": cam["slug"],
            "tem_tjsc": os.path.exists(cam["tjsc"]),
            "tem_rag": os.path.exists(cam["rag"]),
            "n_decisoes": n, "n_merito": merito,
            "tem_floresta": os.path.exists(cam["floresta"]),
            "tem_calibrador": os.path.exists(cam["calibrador"])}


def config_coleta(slug):
    """config.json com o que e' deste cerebro sobrescrito.

    O scraper continua lendo o config.json de sempre (delays, categorias, chave
    do Datajud); o que muda por cerebro e' o relator, o periodo e onde escrever.
    """
    c = obter(slug)
    cam = caminhos(slug)
    with open(os.path.join(RAIZ, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    coleta = c.get("coleta") or {}
    if coleta.get("relator"):
        cfg["relator"] = coleta["relator"]
    for chave in ("data_inicio", "data_fim"):
        if coleta.get(chave):
            cfg[chave] = coleta[chave]
    for chave in ("ano_inicio", "ano_fim"):
        if coleta.get(chave) is not None:
            cfg["portal"][chave] = coleta[chave]
    cfg["saida"] = {"db": cam["tjsc"], "exports": cam["exports"],
                    "documentos": cam["documentos"], "logs": cam["logs"]}
    return cfg


def modelo(slug):
    """Janelas de treino/calibracao. Um acervo de 2015->2026 nao tem a mesma
    janela de um de 1990->2026: corte unico e' errado por construcao. Sem
    declaracao, quem manda sao os defaults de floresta.py/calibrar.py."""
    return dict(obter(slug).get("modelo") or {})


def slug_de(nome):
    sem = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return "-".join(p for p in "".join(
        ch.lower() if ch.isalnum() else " " for ch in sem).split())


def _gravar(dados):
    """tmp + os.replace: o cerebros.json nunca fica pela metade se o processo
    morrer no meio da escrita."""
    tmp = ARQUIVO + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, ARQUIVO)
    _cache["mtime"] = None


def ativar(slug, ativo=True):
    dados = _carregar()
    achou = None
    for c in dados.get("cerebros", []):
        if c["slug"] == slug:
            c["ativo"] = int(bool(ativo))
            achou = c
    if achou is None:
        raise Desconhecido("cérebro desconhecido: %r" % slug)
    _gravar(dados)
    return obter(slug)


def criar(nome, relator=None, ano_inicio=None, slug=None):
    dados = _carregar()
    slug = slug or slug_de(nome)
    if any(c["slug"] == slug for c in dados.get("cerebros", [])):
        raise ValueError("já existe: %s" % slug)
    novo = {"slug": slug, "nome": nome, "ativo": 0,
            "coleta": {"relator": relator or nome}}
    if ano_inicio:
        novo["coleta"]["ano_inicio"] = int(ano_inicio)
    dados.setdefault("cerebros", []).append(novo)
    _gravar(dados)
    os.makedirs(caminhos(slug)["dir"], exist_ok=True)
    return obter(slug)


def argumento(ap, ajuda="cérebro (relator) sobre o qual operar"):
    """--cerebro nos argparse das CLIs. Um lugar so' para o texto de ajuda."""
    ap.add_argument("--cerebro", metavar="SLUG", help=ajuda)
    return ap


def main(argv=None):
    import argparse

    ap = argparse.ArgumentParser(description="Cérebros (acervos) do sistema")
    ap.add_argument("--ativar", metavar="SLUG")
    ap.add_argument("--desativar", metavar="SLUG")
    ap.add_argument("--criar", metavar="NOME")
    ap.add_argument("--relator", help="com --criar: o nome como o portal grafa")
    ap.add_argument("--ano-inicio", type=int, help="com --criar")
    a = ap.parse_args(argv)

    try:
        if a.ativar:
            print("ativado: %s" % ativar(a.ativar, True)["nome"])
            return 0
        if a.desativar:
            print("desativado: %s" % ativar(a.desativar, False)["nome"])
            return 0
        if a.criar:
            c = criar(a.criar, a.relator, a.ano_inicio)
            print("criado: %s (%s) em %s" % (c["slug"], c["nome"], c["dir"]))
            print("agora: python -m src.main --cerebro %s" % c["slug"])
            return 0
    except (Desconhecido, ValueError) as e:
        print(e, file=sys.stderr)
        return 2

    p = padrao()
    print("%-20s %-24s %7s %7s %-9s %-9s %s"
          % ("slug", "nome", "decisões", "mérito", "floresta", "calibr.", "estado"))
    for c in listar(incluir_inativos=True):
        s = saude(c["slug"])
        print("%-20s %-24s %7d %7d %-9s %-9s %s%s"
              % (c["slug"], c["nome"][:24], s["n_decisoes"], s["n_merito"],
                 "sim" if s["tem_floresta"] else "—",
                 "sim" if s["tem_calibrador"] else "—",
                 "ativo" if c["ativo"] else "INATIVO",
                 "  (padrão)" if c["slug"] == p else ""))
    if not os.path.exists(ARQUIVO):
        print("\n(sem %s — usando o cérebro sintético de compatibilidade)" % ARQUIVO)
    return 0


if __name__ == "__main__":
    import tempfile

    # Com argumento, e' ferramenta (listar/ativar/criar). Sem argumento, roda o
    # self-check e DEPOIS lista — e' o que verificar.bat chama.
    if len(sys.argv) > 1:
        sys.exit(main())

    # --- self-check offline, contra um cerebros.json de mentira
    _raiz_real, _arq_real = RAIZ, ARQUIVO
    tmp = tempfile.mkdtemp()
    RAIZ = tmp
    ARQUIVO = os.path.join(tmp, "cerebros.json")
    _cache["mtime"] = None

    # sem arquivo: o mundo de antes desta fase, nos caminhos antigos
    assert [c["slug"] for c in listar()] == [CEREBRO_LEGADO]
    assert padrao() == CEREBRO_LEGADO
    assert caminhos(CEREBRO_LEGADO)["rag"] == os.path.join(tmp, "output", "rag.db")

    _gravar({"padrao": "a", "cerebros": [
        {"slug": "a", "nome": "Álvaro Nunes", "dir": "output"},
        {"slug": "b", "nome": "Beatriz Sá", "ativo": 0,
         "coleta": {"relator": "BEATRIZ SA", "ano_inicio": 2015},
         "modelo": {"ano_corte": 2022}, "esperado": {"decisoes": 1234}}]})

    # inativo so' aparece quando se pede
    assert [c["slug"] for c in listar()] == ["a"]
    assert [c["slug"] for c in listar(incluir_inativos=True)] == ["a", "b"]

    # caminhos: 'dir' declarado manda; sem ele, output/cerebros/<slug>
    assert caminhos("a")["floresta"] == os.path.join(tmp, "output", "floresta.pkl")
    assert caminhos("b")["rag"] == os.path.join(
        tmp, "output", "cerebros", "b", "rag.db")
    assert all(os.path.isabs(v) for k, v in caminhos("b").items()
               if k not in ("slug", "nome", "titulo", "tribunal"))

    # nenhum caminho de um cerebro pode cair dentro do outro
    assert caminhos("a")["rag"] != caminhos("b")["rag"]

    # resolucao
    assert resolver(None) == "a" and resolver("") == "a" and resolver("b") == "b"
    for ruim in ("c", "A", "rubens-schulz"):
        try:
            resolver(ruim)
            raise AssertionError("slug inválido tinha que levantar: %r" % ruim)
        except Desconhecido:
            pass

    # defaults preenchidos, e o que foi declarado sobrevive
    assert obter("a")["tribunal"] == "TJSC" and obter("a")["ativo"] == 1
    assert modelo("b") == {"ano_corte": 2022} and modelo("a") == {}
    assert obter("b")["esperado"]["decisoes"] == 1234

    # saude de acervo que nao existe: zero, sem explodir
    s = saude("b")
    assert s == {"slug": "b", "tem_tjsc": False, "tem_rag": False,
                 "n_decisoes": 0, "n_merito": 0, "tem_floresta": False,
                 "tem_calibrador": False}, s

    # ativar persiste E o cache invalida por mtime (o bug que faria o superadmin
    # ativar um cerebro e nada acontecer ate' reiniciar o servidor)
    ativar("b", True)
    assert [c["slug"] for c in listar()] == ["a", "b"]
    with open(ARQUIVO, encoding="utf-8") as f:
        assert json.load(f)["cerebros"][1]["ativo"] == 1
    ativar("b", False)
    assert [c["slug"] for c in listar()] == ["a"]

    # padrao apontando para nada cai no primeiro ATIVO, nao no primeiro
    _gravar({"padrao": "sumiu", "cerebros": [
        {"slug": "x", "nome": "X", "ativo": 0}, {"slug": "y", "nome": "Y"}]})
    assert padrao() == "y"

    # slug: sem acento, sem maiuscula, sem pontuacao
    assert slug_de("André Luiz Dacol") == "andre-luiz-dacol"
    assert slug_de("  Beatriz  Sá-Nunes ") == "beatriz-sa-nunes"

    # criar nasce INATIVO: acervo vazio nao pode aparecer no seletor de ninguem
    _gravar({"padrao": "y", "cerebros": [{"slug": "y", "nome": "Y"}]})
    c = criar("André Luiz Dacol", ano_inicio=2015)
    assert c["slug"] == "andre-luiz-dacol" and c["ativo"] == 0
    assert os.path.isdir(c["dir"])
    assert [x["slug"] for x in listar()] == ["y"]
    try:
        criar("André Luiz Dacol")
        raise AssertionError("duplicata tinha que levantar")
    except ValueError:
        pass

    RAIZ, ARQUIVO = _raiz_real, _arq_real
    _cache["mtime"] = None
    print("self-check OK — resolução, caminhos isolados, cache por mtime e "
          "ativação persistente")
    print("\ncerebros.json de verdade: %s%s\n"
          % (ARQUIVO, "" if os.path.exists(ARQUIVO)
             else "  (ainda não existe — usando o cérebro sintético)"))
    main([])
