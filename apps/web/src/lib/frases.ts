/**
 * Quebra de fala em pedaços — lógica pura, sem navegador e sem rede,
 * para poder ser testada de fora (apps/api/testes/jarvis-voz.ts).
 */

/**
 * Divide a fala em pedaços que valem a pena gerar separados.
 *
 * Serve para o JARVIS COMEÇAR A FALAR a primeira frase enquanto as outras ainda
 * estão sendo sintetizadas. Antes ele esperava o áudio inteiro ficar pronto e só
 * então abria a boca — num texto de cinco frases, a diferença entre esperar o
 * tempo de uma e o de todas.
 *
 * Pedaços curtos demais ("Claro.") são grudados no próximo: cada ida ao servidor
 * tem um custo fixo que não compensa para duas palavras.
 */
export function emFrases(texto: string, minimo = 60): string[] {
  const brutas = (texto || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…:])\s+/)
    .map((f) => f.trim())
    .filter(Boolean);

  const saida: string[] = [];
  for (const f of brutas) {
    if (saida.length && saida[saida.length - 1].length < minimo) saida[saida.length - 1] += ' ' + f;
    else saida.push(f);
  }
  return saida;
}
