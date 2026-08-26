"""Costura a apresentacao num arquivo HTML unico.

    cd frontend && ARTEFATO=1 npx vite build
    .venv\\Scripts\\python -m apresentacao.artefato

Le o build de frontend/dist-artefato/, embute o JS, o CSS e os tres JSON de
dados no mesmo arquivo, e grava frontend/dist-artefato/apresentacao.html.

O resultado nao chama servidor nenhum: abre no navegador, abre de um pendrive,
abre como anexo. E' por isso que ele tambem NAO tem portao de senha — o portao
mora na rota /apresentacao, que a API serve. Quem recebe este arquivo ve tudo.
"""
import glob
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

AQUI = os.path.dirname(os.path.abspath(__file__))
DADOS = os.path.join(AQUI, "dados")
BUILD = os.path.join(RAIZ, "frontend", "dist-artefato")
SAIDA = os.path.join(BUILD, "cerebro-do-relator.html")

TITULO = "O Cérebro do Relator"

# O arquivo e' um HTML solto: quem o abre nao tem sessao para encerrar, e um
# botao que nao faz nada e' pior que botao nenhum.
EXTRA = """
  body { margin: 0; background: #080c0d; }
  .apr-rodape .apr-sair { display: none; }
"""


def _um(padrao):
    achados = glob.glob(os.path.join(BUILD, "assets", padrao))
    assert len(achados) == 1, "esperava um %s em %s, achei %d — rode o build" % (
        padrao, BUILD, len(achados))
    with open(achados[0], encoding="utf-8") as f:
        return f.read()


def montar():
    css = _um("artefato-*.css")
    js = _um("artefato-*.js")

    dados = {}
    for nome in ("apresentacao", "grafo", "confronto"):
        with open(os.path.join(DADOS, "%s.json" % nome), encoding="utf-8") as f:
            dados[nome] = json.load(f)
    bruto = json.dumps(dados, ensure_ascii=False)

    # a mesma trava de dinheiro do montar.py: este arquivo vai para as maos de
    # quem assiste a demonstracao, e o preco de producao nao vai junto
    assert "US$" not in bruto and "usd" not in bruto.lower(), \
        "valor monetário nos dados — rode apresentacao.montar de novo"

    # fechar </script> dentro de uma string encerra o bloco no parser do HTML;
    # o \\/ e' invisivel para o JSON.parse e salva o arquivo
    bruto = bruto.replace("</", "<\\/")
    assert "</script" not in js.lower(), "o bundle tem </script — precisa escapar também"

    html = [
        # SEM O DOCTYPE o navegador cai em quirks mode, e em quirks mode <table>
        # NAO herda color/font do pai — cai no default do body. Aqui isso apaga
        # a primeira coluna das duas tabelas (o numero do processo e a etapa),
        # que sao as unicas celulas que dependem de heranca. Uma linha, e o
        # sintoma parece bug de CSS.
        '<!doctype html>',
        # e dentro do primeiro kilobyte: sem isto o navegador cai no charset do
        # sistema e a pagina inteira sai com acento quebrado
        '<meta charset="utf-8">',
        "<title>%s</title>" % TITULO,
        "<style>%s</style>" % css,
        "<style>%s</style>" % EXTRA,
        '<div id="raiz"></div>',
        "<script>window.__APRESENTACAO__ = %s;</script>" % bruto,
        '<script type="module">%s</script>' % js,
    ]
    with open(SAIDA, "w", encoding="utf-8") as f:
        f.write("\n".join(html))
    return SAIDA


if __name__ == "__main__":
    caminho = montar()
    print("OK — %s (%.0f KB)" % (caminho, os.path.getsize(caminho) / 1024))
