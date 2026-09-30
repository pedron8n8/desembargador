/** Só chama `f` depois de `ms` sem nenhuma chamada nova. `cancelar()` descarta a chamada pendente. */
export function debounce(f: () => void, ms: number): (() => void) & { cancelar(): void } {
  let t: ReturnType<typeof setTimeout> | undefined
  const chamar = () => {
    clearTimeout(t)
    t = setTimeout(() => {
      t = undefined
      f()
    }, ms)
  }
  chamar.cancelar = () => {
    clearTimeout(t)
    t = undefined
  }
  return chamar
}
