const DELAYS_MS = [0, 30_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export function getBackoffDelay(attemptsMade: number): number {
  return DELAYS_MS[attemptsMade] ?? DELAYS_MS[DELAYS_MS.length - 1]!;
}
