/**
 * "Só a mais recente vale": cada chamada assíncrona pega um `valida()` ao começar; ele só
 * devolve true se nenhuma chamada mais nova começou, ninguém chamou `invalidar()` e o
 * dono não encerrou (unmount). Respostas velhas ou tardias são descartadas.
 */
export function ultimaValida(): { iniciar(): () => boolean; invalidar(): void; encerrar(): void } {
  let n = 0
  let vivo = true
  return {
    iniciar() {
      const meu = ++n
      return () => vivo && meu === n
    },
    /** Descarta tudo o que está em voo (ex.: uma sub-tela acabou de abrir). */
    invalidar() { n++ },
    encerrar() { vivo = false },
  }
}
