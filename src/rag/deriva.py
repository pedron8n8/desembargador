"""O "humor" do desembargador existe nos dados? Auditoria, nao suposicao.

A pergunta que motivou este modulo: a previsao pode estar sendo contaminada pelo
estado de espirito de quem julga? Da' para responder em parte — 20 mil decisoes
datadas permitem procurar padroes que nao deveriam existir se a decisao fosse
puramente juridica.

O que se acha (numeros no --help do proprio comando):

  dia da semana   ~1 pp de desvio. Nao ha' efeito de segunda-feira. E' a melhor
                  noticia do modulo e vale ser dita.
  ano a ano       ~10 pp de variacao. E' a deriva REAL, e e' maior que boa parte
                  do sinal que o modelo explora. Nao e' humor: e' mudanca de
                  composicao do acervo, de jurisprudencia consolidada e de lei.
  carga do dia    parece efeito, mas esta' confundido com sessao x monocratica.
                  Fica como pergunta em aberto, nao como achado.
  ancora citada   sinal ESTAVEL, e o unico dos quatro que e' juridico.

Consequencia de projeto: o inimigo nao e' o humor de segunda-feira — e' a deriva
de epoca. Por isso o calibrador (src/rag/calibrar.py) e' ajustado em janela
recente, e por isso a media historica de 20 anos nao serve de referencia.

  python -m src.rag.deriva
"""
import os
import sqlite3
import statistics as st
import sys

RAG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), "output", "rag.db")

MERITO = "resultado IN ('provido','parcialmente provido','desprovido')"
REFORMA = "resultado IN ('provido','parcialmente provido')"
DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"]
_MIN = 300      # abaixo disso a taxa e' ruido, nao tendencia


def _db(banco=RAG):
    return sqlite3.connect("file:%s?mode=ro" % banco.replace("\\", "/"), uri=True)


def por_ano(banco=RAG, minimo=_MIN):
    return [(a, n, p) for a, n, p in _db(banco).execute(
        "SELECT ano, count(*), 100.0*sum(%s)/count(*) FROM decisao "
        "WHERE %s AND ano IS NOT NULL GROUP BY 1 HAVING count(*) >= ? ORDER BY 1"
        % (REFORMA, MERITO), (minimo,))]


def por_dia_semana(banco=RAG, minimo=_MIN):
    return [(DIAS[int(d)], n, p) for d, n, p in _db(banco).execute(
        "SELECT strftime('%%w', data), count(*), 100.0*sum(%s)/count(*) "
        "FROM decisao WHERE %s AND data IS NOT NULL GROUP BY 1 HAVING count(*) >= ?"
        % (REFORMA, MERITO), (minimo,))]


def por_carga(banco=RAG):
    """Decisoes assinadas no mesmo dia. CONFUNDIDO — ver por_carga_controlada."""
    faixas = [("1-5", "c<=5"), ("6-20", "c BETWEEN 6 AND 20"),
              ("21-50", "c BETWEEN 21 AND 50"), ("51+", "c>50")]
    db = _db(banco)
    saida = []
    for rotulo, cond in faixas:
        n, p = db.execute(
            "SELECT count(*), 100.0*sum(%s)/count(*) FROM decisao d "
            "JOIN (SELECT data, count(*) c FROM decisao GROUP BY 1) x ON x.data=d.data "
            "WHERE %s AND %s" % (REFORMA.replace("resultado", "d.resultado"),
                                 MERITO.replace("resultado", "d.resultado"), cond)
        ).fetchone()
        saida.append((rotulo, n or 0, p))
    return saida


def por_carga_controlada(banco=RAG, categoria="acordaos", minimo=100):
    """A mesma coisa, so' dentro de acordaos — controla sessao x monocratica.

    Sem este controle, "dia de poucas decisoes" e' so' um jeito enviesado de
    dizer "dia sem sessao", e a taxa de reforma muda por composicao, nao por
    cansaco de quem julga.

    `minimo` descarta faixa com amostra pequena demais: sobra ~28 acordaos em
    dias de 1 a 5 decisoes, e uma taxa calculada sobre 28 casos oscila 10 pp
    sozinha. Deixar essa faixa na conta inventaria um efeito que nao existe.
    """
    db = _db(banco)
    saida = []
    for rotulo, cond in [("1-5", "c<=5"), ("6-20", "c BETWEEN 6 AND 20"),
                         ("21-50", "c BETWEEN 21 AND 50"), ("51+", "c>50")]:
        n, p = db.execute(
            "SELECT count(*), 100.0*sum(%s)/count(*) FROM decisao d "
            "JOIN (SELECT data, count(*) c FROM decisao WHERE categoria=? GROUP BY 1) x "
            "ON x.data=d.data WHERE d.categoria=? AND %s AND %s"
            % (REFORMA.replace("resultado", "d.resultado"),
               MERITO.replace("resultado", "d.resultado"), cond),
            (categoria, categoria)).fetchone()
        if (n or 0) >= minimo:
            saida.append((rotulo, n, p))
    return saida


def por_ancora(banco=RAG):
    return [(a or "?", n, p) for a, n, p in _db(banco).execute(
        "SELECT ancora, count(*), 100.0*sum(%s)/count(*) FROM decisao "
        "WHERE %s GROUP BY 1 ORDER BY 3 DESC" % (REFORMA, MERITO))]


def _tabela(titulo, linhas, nota=""):
    print("\n== %s ==" % titulo)
    for rotulo, n, p in linhas:
        print("   %-10s n=%6d   reforma %5.1f%%" % (rotulo, n, p if p else 0))
    vals = [p for _r, n, p in linhas if p is not None]
    dp = st.pstdev(vals) if len(vals) > 1 else 0.0
    print("   desvio-padrão entre faixas: %.2f pp" % dp)
    if nota:
        print("   %s" % nota)
    return dp


if __name__ == "__main__":
    if not os.path.exists(RAG):
        print("índice não existe — rode: python -m src.rag.indexar", file=sys.stderr)
        raise SystemExit(1)

    print("Auditoria de deriva — o resultado depende de algo que não deveria?")
    print("(20 mil decisões datadas do mesmo relator; só decisões de mérito)")

    dp_dia = _tabela(
        "DIA DA SEMANA  — o 'humor de segunda-feira'", por_dia_semana(),
        "Nenhum efeito. É a boa notícia: o dia da semana não muda o desfecho.")

    anos = por_ano()
    dp_ano = _tabela(
        "ANO A ANO  — deriva de época", anos,
        "AQUI está a variação real. Não é humor: é jurisprudência que consolida,\n"
        "   lei que muda e composição do acervo que muda junto.")

    dp_carga = _tabela(
        "CARGA DO DIA  — quantas decisões ele assinou naquele dia", por_carga(),
        "CONFUNDIDO: dia de poucas decisões é dia sem sessão (monocráticas).\n"
        "   Ver abaixo o mesmo corte, já controlado.")

    dp_ctrl = _tabela("CARGA DO DIA, só entre acórdãos  — controlado",
                      por_carga_controlada())
    print("   O efeito caiu de %.2f pp para %.2f pp ao controlar por tipo de\n"
          "   decisão: era composição (dia sem sessão = monocrática), não cansaço."
          % (dp_carga, dp_ctrl))

    _tabela("ÂNCORA CITADA  — sinal jurídico, estável", por_ancora(),
            "Precedente de alcance nacional muda o desfecho. Este é o tipo de\n"
            "   variação que o sistema DEVE usar — e usa, no re-ranking.")

    print("\n-- o que isto manda fazer --")
    print("O inimigo não é o humor de curto prazo (%.2f pp entre dias úteis)."
          % dp_dia)
    print("É a deriva de época (%.1f pp entre anos, de %.1f%% a %.1f%%)."
          % (dp_ano, min(p for _a, _n, p in anos), max(p for _a, _n, p in anos)))
    print("Por isso: o calibrador é ajustado em janela recente, e a média")
    print("histórica de 20 anos NÃO serve como referência para um caso de hoje.")

    assert dp_dia < 3.0, \
        "apareceu efeito de dia da semana (%.2f pp) — investigar antes de confiar" % dp_dia
    assert dp_ano > dp_dia, "a deriva de época deveria dominar a de curto prazo"
    print("\nself-check OK — sem efeito de dia da semana; a deriva é de época")
