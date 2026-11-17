// Utilitários das demos.
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Pausa entre passos. Com movimento reduzido, os passos continuam em sequência (para leitura), sem animação. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const pretty = (v) => JSON.stringify(v, null, 2);

/** Garante que só uma execução de cada demo rode por vez; um reset invalida a execução anterior. */
export function runGuard() {
  let token = 0;
  return {
    start() { token += 1; return token; },
    cancel() { token += 1; },
    alive(t) { return t === token; },
  };
}
