/** Heuristic tokens for mixed prose + code. Conservative (slightly high). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 3.6));
}

export function estimateTokensFromBytes(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.max(1, Math.round(bytes / 3.6));
}

export function savingsPercent(mapTokens: number, rawTokens: number): number {
  if (rawTokens <= 0) return 0;
  const pct = (1 - mapTokens / rawTokens) * 100;
  return Math.max(0, Math.min(99.9, Math.round(pct * 10) / 10));
}
